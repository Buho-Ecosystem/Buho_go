/**
 * Contact chat protocol tests (BuhoGO convention v1).
 *
 * The builders write what peers read and `parseRumor` reads what strangers
 * write, so the cases cover both directions: exact fallback texts, every
 * builder refusal, a builder -> createRumor -> parseRumor round trip for each
 * message type, and the hostile rumors a peer can craft (forged amounts,
 * a missing Lightning address, groups, unknown versions) that must end as degraded text or
 * as nothing, never as a pay action and never as an exception.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/protocol.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { createRumor, generateSecretKey, nip19 } from 'nostr-core';
import { MAX_NOTE_LENGTH, MAX_TEXT_LENGTH, MAX_VERIFY_URL_LENGTH, REQUEST_LIFETIME_SECONDS } from '../constants.js';
import { DM_ERROR, DmError } from '../errors.js';
import {
  MESSAGE_TYPE,
  isFileMessage,
  REQUEST_STATUS,
  buildPaymentTemplate,
  buildReactionTemplate,
  buildRequestTemplate,
  buildStatusTemplate,
  buildTextTemplate,
  containsSecretKey,
  parseRumor,
} from '../protocol.js';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);
const REQUEST_ID = 'd'.repeat(64);
const PREIMAGE = 'e'.repeat(64);
const NOW = 1_760_000_000;
const now = () => NOW;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run `fn` and return the DmError it throws; fails the test when it does not throw one. */
function dmError(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(DmError.is(err), `expected a DmError, got ${inspect(err)}`);
    return err;
  }
  return assert.fail('expected a DmError');
}

const throwsCode = (code, fn) => assert.equal(dmError(fn).code, code);

/** A template as the rumor a sender `from` would produce. */
const toRumor = (template, from = PEER) => createRumor(template, from);

/** Parse a template as received by ME from PEER. */
const received = (template) => parseRumor(toRumor(template, PEER), { me: ME });

/** The same template, replacing selected tags: `replace` maps a tag name to its new tag (or null). */
function withTags(template, mutate) {
  return { ...template, tags: mutate(template.tags.map((tag) => [...tag])) };
}

const swapTag = (name, replacement) => (tags) =>
  tags.flatMap((tag) => (tag[0] === name ? (replacement ? [replacement] : []) : [tag]));

const ADDRESS = 'me@buho.example';

const requestTemplate = (overrides = {}) =>
  buildRequestTemplate({ recipient: ME, amountSats: 12_000, lud16: ADDRESS, now, ...overrides });

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

test('MESSAGE_TYPE and REQUEST_STATUS carry the contract values and are frozen', () => {
  assert.deepEqual(MESSAGE_TYPE, {
    TEXT: 'text',
    REQUEST: 'request',
    STATUS: 'status',
    PAYMENT: 'payment',
    REACTION: 'reaction',
  });
  assert.deepEqual(REQUEST_STATUS, {
    PAID: 'paid',
    DECLINED: 'declined',
    CANCELLED: 'cancelled',
    REMINDER: 'reminder',
  });
  for (const table of [MESSAGE_TYPE, REQUEST_STATUS]) {
    assert.ok(Object.isFrozen(table));
    assert.throws(() => { table.NEW = 'x'; }, TypeError);
  }
});

// ---------------------------------------------------------------------------
// containsSecretKey
// ---------------------------------------------------------------------------

const NSEC = nip19.nsecEncode(generateSecretKey());
const NCRYPTSEC = `ncryptsec1${'q9x8gf2tvdw0s3jn54khce6mua7l'.repeat(6).slice(0, 152)}`;

const SECRET_TEXTS = [
  NSEC,
  NSEC.toUpperCase(),
  `my key is ${NSEC} please keep it`,
  `${NSEC}\n`,
  `prefix${NSEC}`,
  `${NSEC}trailing`,
  NCRYPTSEC,
  NCRYPTSEC.toUpperCase(),
  `backup: ${NCRYPTSEC}.`,
];

for (const text of SECRET_TEXTS) {
  test(`containsSecretKey detects a key in ${inspect(text.slice(0, 24))}...`, () => {
    assert.equal(containsSecretKey(text), true);
  });
}

const HARMLESS_TEXTS = [
  '',
  'hello',
  'nsec',
  'nsec1',
  nip19.npubEncode('f'.repeat(64)),
  NSEC.slice(0, -1), // 57 data characters: not a key
  `nsec1${'b'.repeat(58)}`, // "b" is not a bech32 character
  'nsec1 ' + NSEC.slice(5),
  'a'.repeat(64),
  'ncryptsec1qq',
  null,
  undefined,
  42,
  {},
  [NSEC],
];

for (const text of HARMLESS_TEXTS) {
  test(`containsSecretKey is false for ${inspect(text)}`, () => {
    assert.equal(containsSecretKey(text), false);
  });
}

// ---------------------------------------------------------------------------
// buildTextTemplate
// ---------------------------------------------------------------------------

test('buildTextTemplate builds a kind 14 message with the text as content', () => {
  assert.deepEqual(buildTextTemplate({ recipient: PEER, text: 'Hello', now }), {
    kind: 14,
    tags: [['p', PEER]],
    content: 'Hello',
    created_at: NOW,
  });
});

test('buildTextTemplate trims the text and adds a reply tag', () => {
  const template = buildTextTemplate({ recipient: PEER, text: '  hi there \n', replyTo: REQUEST_ID, now });
  assert.equal(template.content, 'hi there');
  assert.deepEqual(template.tags, [['p', PEER], ['e', REQUEST_ID, '', 'reply']]);
});

test('buildTextTemplate takes its timestamp from the clock, default included', () => {
  const before = Math.floor(Date.now() / 1000);
  const { created_at: createdAt } = buildTextTemplate({ recipient: PEER, text: 'x' });
  assert.ok(createdAt >= before && createdAt <= before + 5);
});

test('buildTextTemplate accepts exactly MAX_TEXT_LENGTH code points, emoji counted once', () => {
  const owl = '\u{1F989}';
  assert.equal(buildTextTemplate({ recipient: PEER, text: owl.repeat(MAX_TEXT_LENGTH), now }).content.length, MAX_TEXT_LENGTH * 2);
  throwsCode(DM_ERROR.MESSAGE_TOO_LARGE, () =>
    buildTextTemplate({ recipient: PEER, text: owl.repeat(MAX_TEXT_LENGTH + 1), now }),
  );
});

test('buildTextTemplate refuses a secret key with SECRET_KEY_IN_TEXT', () => {
  throwsCode(DM_ERROR.SECRET_KEY_IN_TEXT, () => buildTextTemplate({ recipient: PEER, text: `here ${NSEC}`, now }));
});

const BAD_RECIPIENTS = ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), `${PEER}0`, ` ${PEER}`, null, undefined, 42, {}, [PEER]];

for (const recipient of BAD_RECIPIENTS) {
  test(`every builder refuses the recipient ${inspect(recipient)}`, () => {
    const common = { recipient, now };
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildTextTemplate({ ...common, text: 'x' }));
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildRequestTemplate({ ...common, amountSats: 12_000, lud16: ADDRESS }));
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildStatusTemplate({ ...common, requestId: REQUEST_ID, value: 'declined' }));
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildPaymentTemplate({ ...common, amountSats: 5, preimage: PREIMAGE }));
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildReactionTemplate({ ...common, targetId: REQUEST_ID, emoji: '+' }));
  });
}

const BAD_TEXTS = ['', '   ', '\n\t', null, undefined, 42, {}, ['hi']];

for (const text of BAD_TEXTS) {
  test(`buildTextTemplate refuses the text ${inspect(text)}`, () => {
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildTextTemplate({ recipient: PEER, text, now }));
  });
}

test('every builder refuses a missing options object and a bad clock', () => {
  for (const build of [buildTextTemplate, buildRequestTemplate, buildStatusTemplate, buildPaymentTemplate, buildReactionTemplate]) {
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => build());
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => build({ recipient: PEER, now: () => 1.5 }));
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => build({ recipient: PEER, now: () => NaN }));
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => build({ recipient: PEER, now: 'soon' }));
  }
});

test('buildTextTemplate refuses a malformed reply target', () => {
  throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildTextTemplate({ recipient: PEER, text: 'x', replyTo: 'abc', now }));
});

// ---------------------------------------------------------------------------
// buildRequestTemplate
// ---------------------------------------------------------------------------

test('buildRequestTemplate writes the tags and the fallback of docs section 4', () => {
  const template = requestTemplate({ note: 'Pizza' });
  assert.deepEqual(template, {
    kind: 14,
    tags: [
      ['p', ME],
      ['buho', 'request', '1'],
      ['amount', '12000000'],
      ['lud16', ADDRESS],
      ['valid_until', String(NOW + REQUEST_LIFETIME_SECONDS)],
      ['note', 'Pizza'],
    ],
    content: `\u{1F4B8} Payment request: 12,000 sats – Pizza\nPay to: ${ADDRESS}`,
    created_at: NOW,
  });
});

test('buildRequestTemplate carries no invoice and leaves out ` - note` and the note tag when there is none', () => {
  for (const note of [undefined, null, '', '   ']) {
    const template = requestTemplate({ note });
    assert.equal(template.content, `\u{1F4B8} Payment request: 12,000 sats\nPay to: ${ADDRESS}`);
    assert.deepEqual(template.tags.map((tag) => tag[0]), ['p', 'buho', 'amount', 'lud16', 'valid_until']);
  }
});

const FALLBACK_AMOUNTS = [
  [1, '1'],
  [999, '999'],
  [1_000, '1,000'],
  [12_000, '12,000'],
  [1_234_567, '1,234,567'],
  [100_000_000, '100,000,000'],
];

for (const [sats, formatted] of FALLBACK_AMOUNTS) {
  test(`the request fallback formats ${sats} sats as "${formatted}"`, () => {
    const template = requestTemplate({ amountSats: sats });
    assert.ok(template.content.startsWith(`\u{1F4B8} Payment request: ${formatted} sats\n`));
    assert.deepEqual(template.tags[2], ['amount', String(sats * 1000)]);
  });
}

const BAD_AMOUNTS = [0, -1, 1.5, NaN, Infinity, '12000', null, undefined, Number.MAX_SAFE_INTEGER, 2 ** 53];

for (const amountSats of BAD_AMOUNTS) {
  test(`buildRequestTemplate and buildPaymentTemplate refuse amountSats ${inspect(amountSats)}`, () => {
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => requestTemplate({ amountSats }));
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildPaymentTemplate({ recipient: PEER, amountSats, preimage: PREIMAGE, now }));
  });
}

// [description, overrides, expected code]
const BAD_REQUESTS = [
  ['a note over the limit', { note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }, DM_ERROR.MESSAGE_TOO_LARGE],
  ['a non-string note', { note: 5 }, DM_ERROR.INVALID_ARGUMENT],
  ['no lud16', { lud16: undefined }, DM_ERROR.INVALID_ARGUMENT],
  ['a null lud16', { lud16: null }, DM_ERROR.INVALID_ARGUMENT],
  ['a malformed lud16', { lud16: 'not an address' }, DM_ERROR.INVALID_ARGUMENT],
  ['a non-string lud16', { lud16: 5 }, DM_ERROR.INVALID_ARGUMENT],
  ['an over-long lud16', { lud16: `${'a'.repeat(320)}@x.io` }, DM_ERROR.INVALID_ARGUMENT],
];

for (const [description, overrides, code] of BAD_REQUESTS) {
  test(`buildRequestTemplate refuses ${description} with ${code}`, () => {
    throwsCode(code, () => requestTemplate(overrides));
  });
}

test('buildRequestTemplate accepts a note of exactly MAX_NOTE_LENGTH code points', () => {
  const note = '\u{1F355}'.repeat(MAX_NOTE_LENGTH);
  assert.equal(requestTemplate({ note }).tags[5][1], note);
});

// ---------------------------------------------------------------------------
// buildStatusTemplate
// ---------------------------------------------------------------------------

// [value, extra options, expected fallback]
const STATUS_FALLBACKS = [
  ['paid', { amountSats: 12_000 }, '✅ Paid: 12,000 sats'],
  ['paid', {}, '✅ Paid'],
  ['declined', {}, '✖️ Declined the payment request'],
  ['cancelled', {}, '↩️ Withdrew the payment request'],
  ['reminder', {}, '\u{1F514} Reminder: payment request still open'],
];

for (const [value, extra, content] of STATUS_FALLBACKS) {
  test(`buildStatusTemplate(${value}) writes the fallback "${content.replace('\n', ' ')}"`, () => {
    const template = buildStatusTemplate({ recipient: PEER, requestId: REQUEST_ID, value, now, ...extra });
    assert.deepEqual(template, {
      kind: 14,
      tags: [['p', PEER], ['e', REQUEST_ID, '', 'reply'], ['buho', 'status', value, '1']],
      content,
      created_at: NOW,
    });
  });
}

test('buildStatusTemplate adds the preimage tag to a paid status', () => {
  const template = buildStatusTemplate({ recipient: PEER, requestId: REQUEST_ID, value: 'paid', preimage: PREIMAGE, now });
  assert.deepEqual(template.tags.at(-1), ['preimage', PREIMAGE]);
});

// [description, overrides]
const BAD_STATUSES = [
  ['an unknown value', { value: 'refunded' }],
  ['a missing value', { value: undefined }],
  ['a value in the wrong case', { value: 'PAID' }],
  ['no request id', { requestId: undefined }],
  ['a malformed request id', { requestId: 'abc' }],
  ['a malformed preimage', { value: 'paid', preimage: 'abc' }],
  ['a preimage on a declined status', { value: 'declined', preimage: PREIMAGE }],
  ['a bad paid amount', { value: 'paid', amountSats: -5 }],
];

for (const [description, overrides] of BAD_STATUSES) {
  test(`buildStatusTemplate refuses ${description}`, () => {
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () =>
      buildStatusTemplate({ recipient: PEER, requestId: REQUEST_ID, value: 'paid', now, ...overrides }),
    );
  });
}

// ---------------------------------------------------------------------------
// buildPaymentTemplate
// ---------------------------------------------------------------------------

test('buildPaymentTemplate writes the tags and the fallback of docs section 4', () => {
  const template = buildPaymentTemplate({
    recipient: PEER,
    amountSats: 5_000,
    note: 'Coffee',
    preimage: PREIMAGE,
    requestId: REQUEST_ID,
    now,
  });
  assert.deepEqual(template, {
    kind: 14,
    tags: [
      ['p', PEER],
      ['buho', 'payment', '1'],
      ['amount', '5000000'],
      ['note', 'Coffee'],
      ['preimage', PREIMAGE],
      ['e', REQUEST_ID, '', 'reply'],
    ],
    content: '↗ Sent 5,000 sats – Coffee',
    created_at: NOW,
  });
});

test('buildPaymentTemplate leaves out the note and the request link when there are none', () => {
  const template = buildPaymentTemplate({ recipient: PEER, amountSats: 1, preimage: PREIMAGE, now });
  assert.equal(template.content, '↗ Sent 1 sats');
  assert.deepEqual(template.tags.map((tag) => tag[0]), ['p', 'buho', 'amount', 'preimage']);
});

test('buildPaymentTemplate leaves out the preimage tag when the wallet gave none', () => {
  for (const preimage of [undefined, null]) {
    const template = buildPaymentTemplate({ recipient: PEER, amountSats: 5, preimage, now });
    assert.deepEqual(template.tags.map((tag) => tag[0]), ['p', 'buho', 'amount']);
  }
});

test('buildPaymentTemplate validates a present preimage, the request id and the note', () => {
  const base = { recipient: PEER, amountSats: 5, preimage: PREIMAGE, now };
  throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildPaymentTemplate({ ...base, preimage: 'E'.repeat(64) }));
  throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildPaymentTemplate({ ...base, requestId: 'abc' }));
  throwsCode(DM_ERROR.MESSAGE_TOO_LARGE, () => buildPaymentTemplate({ ...base, note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }));
});

// ---------------------------------------------------------------------------
// buildReactionTemplate
// ---------------------------------------------------------------------------

test('buildReactionTemplate writes a kind 7 with e, p and k tags', () => {
  assert.deepEqual(buildReactionTemplate({ recipient: PEER, targetId: REQUEST_ID, emoji: '\u{1F44D}', now }), {
    kind: 7,
    tags: [['e', REQUEST_ID], ['p', PEER], ['k', '14']],
    content: '\u{1F44D}',
    created_at: NOW,
  });
});

test('buildReactionTemplate keeps the NIP-25 shorthands as written', () => {
  for (const emoji of ['+', '-']) {
    assert.equal(buildReactionTemplate({ recipient: PEER, targetId: REQUEST_ID, emoji, now }).content, emoji);
  }
});

const BAD_EMOJIS = ['', '  ', 'x'.repeat(65), null, undefined, 5, {}];

for (const emoji of BAD_EMOJIS) {
  test(`buildReactionTemplate refuses the emoji ${inspect(emoji)}`, () => {
    throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildReactionTemplate({ recipient: PEER, targetId: REQUEST_ID, emoji, now }));
  });
}

test('buildReactionTemplate refuses a malformed target and accepts 64 code points of emoji', () => {
  throwsCode(DM_ERROR.INVALID_ARGUMENT, () => buildReactionTemplate({ recipient: PEER, targetId: 'abc', emoji: '+', now }));
  const long = '\u{1F600}'.repeat(64);
  assert.equal(buildReactionTemplate({ recipient: PEER, targetId: REQUEST_ID, emoji: long, now }).content, long);
});

// ---------------------------------------------------------------------------
// Round trips: builder -> createRumor -> parseRumor
// ---------------------------------------------------------------------------

test('round trip: a text message', () => {
  const template = buildTextTemplate({ recipient: ME, text: 'Lunch?', replyTo: REQUEST_ID, now });
  const rumor = toRumor(template);
  assert.deepEqual(parseRumor(rumor, { me: ME }), {
    id: rumor.id,
    kind: 14,
    type: 'text',
    sender: PEER,
    recipient: ME,
    partner: PEER,
    outgoing: false,
    createdAt: NOW,
    text: 'Lunch?',
    replyTo: REQUEST_ID,
    request: null,
    status: null,
    payment: null,
    reaction: null,
    degraded: false,
  });
});

test('round trip: a payment request', () => {
  const template = requestTemplate({ note: 'Pizza' });
  const rumor = toRumor(template);
  const message = parseRumor(rumor, { me: ME });
  assert.equal(message.type, 'request');
  assert.equal(message.degraded, false);
  assert.equal(message.text, template.content);
  assert.equal(message.replyTo, null);
  assert.deepEqual(message.request, {
    amountSats: 12_000,
    note: 'Pizza',
    lud16: ADDRESS,
    validUntil: NOW + REQUEST_LIFETIME_SECONDS,
  });
  assert.equal(message.status, null);
  assert.equal(message.payment, null);
});

test('round trip: a request without a note has null for it', () => {
  assert.equal(received(requestTemplate()).request.note, null);
});

// ---------------------------------------------------------------------------
// Request lifetime (docs section 8a)
// ---------------------------------------------------------------------------

test('a request carries valid_until = created_at + 30 days unless the caller names one', () => {
  const tag = (template) => template.tags.find((t) => t[0] === 'valid_until');
  assert.deepEqual(tag(requestTemplate()), ['valid_until', String(NOW + 30 * 24 * 60 * 60)]);
  assert.deepEqual(tag(requestTemplate({ validUntil: NOW + 600 })), ['valid_until', String(NOW + 600)]);
});

test('round trip: valid_until survives', () => {
  assert.equal(received(requestTemplate({ validUntil: NOW + 600 })).request.validUntil, NOW + 600);
});

test('builders refuse a valid_until that is not after the request was created', () => {
  for (const validUntil of [NOW, NOW - 1, 0, -5, 1.5, '1760000100', Number.NaN]) {
    assert.throws(
      () => requestTemplate({ validUntil }),
      (e) => DmError.is(e, DM_ERROR.INVALID_ARGUMENT),
      String(validUntil),
    );
  }
});

test('a missing, malformed or already-over valid_until degrades the request to text (no pay action)', () => {
  const missing = received(withTags(requestTemplate(), swapTag('valid_until', null)));
  assert.equal(missing.degraded, true);
  assert.equal(missing.request, null);
  for (const value of ['soon', '', '-1', '0', '1.5', '17600000000000000', String(NOW), String(NOW - 10)]) {
    const message = received(withTags(requestTemplate(), swapTag('valid_until', ['valid_until', value])));
    assert.equal(message.degraded, true, value);
    assert.equal(message.type, 'text', value);
    assert.equal(message.request, null, value);
  }
  const twice = withTags(requestTemplate(), (tags) => [...tags, ['valid_until', String(NOW + 5)]]);
  assert.equal(received(twice).degraded, true);
});

// [description, build options, expected status field]
const STATUS_ROUND_TRIPS = [
  ['paid with a preimage', { value: 'paid', preimage: PREIMAGE, amountSats: 12_000 }, { value: 'paid', preimage: PREIMAGE }],
  ['paid without a preimage', { value: 'paid' }, { value: 'paid', preimage: null }],
  ['declined', { value: 'declined' }, { value: 'declined', preimage: null }],
  ['cancelled', { value: 'cancelled' }, { value: 'cancelled', preimage: null }],
  ['reminder', { value: 'reminder' }, { value: 'reminder', preimage: null }],
];

for (const [description, options, expected] of STATUS_ROUND_TRIPS) {
  test(`round trip: a status message, ${description}`, () => {
    const template = buildStatusTemplate({ recipient: ME, requestId: REQUEST_ID, now, ...options });
    const message = received(template);
    assert.equal(message.type, 'status');
    assert.equal(message.degraded, false);
    assert.equal(message.text, template.content);
    assert.equal(message.replyTo, REQUEST_ID);
    assert.deepEqual(message.status, { requestId: REQUEST_ID, ...expected });
  });
}

test('round trip: a payment, with and without request and note', () => {
  const full = received(
    buildPaymentTemplate({ recipient: ME, amountSats: 5_000, note: 'Coffee', preimage: PREIMAGE, requestId: REQUEST_ID, now }),
  );
  assert.equal(full.type, 'payment');
  assert.equal(full.degraded, false);
  assert.equal(full.text, '↗ Sent 5,000 sats – Coffee');
  assert.deepEqual(full.payment, { amountSats: 5_000, note: 'Coffee', preimage: PREIMAGE, requestId: REQUEST_ID, verifyUrl: null });

  const bare = received(buildPaymentTemplate({ recipient: ME, amountSats: 1, preimage: PREIMAGE, now }));
  assert.deepEqual(bare.payment, { amountSats: 1, note: null, preimage: PREIMAGE, requestId: null, verifyUrl: null });

  const noProof = received(buildPaymentTemplate({ recipient: ME, amountSats: 7, now }));
  assert.equal(noProof.type, 'payment');
  assert.equal(noProof.degraded, false);
  assert.deepEqual(noProof.payment, { amountSats: 7, note: null, preimage: null, requestId: null, verifyUrl: null });
});

test('payment: the optional LUD-21 verify tag round-trips', () => {
  const url = 'https://getalby.com/lnurlp/alice/verify/abc';
  const template = buildPaymentTemplate({ recipient: ME, amountSats: 5_000, requestId: REQUEST_ID, verifyUrl: url, now });
  assert.deepEqual(template.tags.filter((t) => t[0] === 'verify'), [['verify', url]]);
  assert.equal(received(template).payment.verifyUrl, url);
  assert.equal(buildPaymentTemplate({ recipient: ME, amountSats: 5_000, now }).tags.some((t) => t[0] === 'verify'), false);
});

test('payment: a verify URL that is not https, too long or junk is dropped, never an error', () => {
  const tooLong = `https://getalby.com/${'a'.repeat(MAX_VERIFY_URL_LENGTH)}`;
  for (const bad of ['http://getalby.com/verify', 'javascript:alert(1)', 'not a url', tooLong, 42, '']) {
    const built = buildPaymentTemplate({ recipient: ME, amountSats: 5_000, verifyUrl: bad, now });
    assert.equal(built.tags.some((t) => t[0] === 'verify'), false, String(bad).slice(0, 30));
    assert.equal(received(built).payment.verifyUrl, null);
  }
  // A foreign client's tag is dropped the same way when parsed; the payment itself stays intact.
  for (const bad of ['http://getalby.com/verify', 'ftp://x/y', 'junk', tooLong]) {
    const template = buildPaymentTemplate({ recipient: ME, amountSats: 5_000, now });
    template.tags.push(['verify', bad]);
    const message = received(template);
    assert.equal(message.degraded, false);
    assert.equal(message.payment.verifyUrl, null);
    assert.equal(message.payment.amountSats, 5_000);
  }
});

// [content, expected emoji]
const REACTION_ROUND_TRIPS = [
  ['+', '\u{1F44D}'],
  ['-', '\u{1F44E}'],
  ['❤️', '❤️'],
  ['\u{1F468}‍\u{1F469}‍\u{1F467}', '\u{1F468}‍\u{1F469}‍\u{1F467}'],
];

for (const [emoji, expected] of REACTION_ROUND_TRIPS) {
  test(`round trip: a reaction with ${inspect(emoji)}`, () => {
    const template = buildReactionTemplate({ recipient: ME, targetId: REQUEST_ID, emoji, now });
    const message = received(template);
    assert.equal(message.kind, 7);
    assert.equal(message.type, 'reaction');
    assert.equal(message.partner, PEER);
    assert.equal(message.text, expected);
    assert.deepEqual(message.reaction, { targetId: REQUEST_ID, emoji: expected });
    assert.equal(message.request, null);
  });
}

test('round trip: my own message (self copy) is outgoing and names the contact as partner', () => {
  const rumor = toRumor(buildTextTemplate({ recipient: PEER, text: 'sent by me', now }), ME);
  const message = parseRumor(rumor, { me: ME });
  assert.equal(message.outgoing, true);
  assert.equal(message.sender, ME);
  assert.equal(message.recipient, PEER);
  assert.equal(message.partner, PEER);

  const reaction = parseRumor(
    toRumor(buildReactionTemplate({ recipient: PEER, targetId: REQUEST_ID, emoji: '+', now }), ME),
    { me: ME },
  );
  assert.equal(reaction.partner, PEER);
  assert.equal(reaction.outgoing, true);
});

// ---------------------------------------------------------------------------
// parseRumor: not part of a one-to-one conversation
// ---------------------------------------------------------------------------

test('parseRumor returns null for kinds other than 14, 15 and 7', () => {
  for (const kind of [0, 1, 13, 1059, 10050]) {
    assert.equal(parseRumor({ ...toRumor(buildTextTemplate({ recipient: ME, text: 'x', now })), kind }, { me: ME }), null);
  }
});

test('parseRumor: a file message from another app is kept as "a file", never its link', () => {
  const file = toRumor({ kind: 15, tags: [['p', ME], ['file-type', 'image/jpeg'], ['decryption-key', 'k']], content: 'https://files.example/abc', created_at: NOW }, PEER);
  const message = parseRumor(file, { me: ME });
  assert.equal(message.type, MESSAGE_TYPE.TEXT);
  assert.equal(message.text, '', 'the link is not shown');
  assert.equal(isFileMessage(message), true);
  assert.equal(isFileMessage(parseRumor(toRumor(buildTextTemplate({ recipient: ME, text: 'x', now }), PEER), { me: ME })), false);
});

test('parseRumor returns null for a group message in either direction', () => {
  const group = (from, tags) => parseRumor(toRumor({ kind: 14, tags, content: 'hi', created_at: NOW }, from), { me: ME });
  assert.equal(group(PEER, [['p', ME], ['p', THIRD]]), null);
  assert.equal(group(ME, [['p', PEER], ['p', THIRD]]), null);
  // The same participants repeated are still one conversation.
  assert.equal(group(PEER, [['p', ME], ['p', ME], ['p', PEER]])?.partner, PEER);
  assert.equal(group(ME, [['p', PEER], ['p', PEER]])?.partner, PEER);
});

test('parseRumor returns null for a note to self, a rumor not addressed to me and a reaction in a group', () => {
  const parse = (from, tags, kind = 14) =>
    parseRumor(toRumor({ kind, tags, content: kind === 7 ? '+' : 'x', created_at: NOW }, from), { me: ME });
  assert.equal(parse(ME, [['p', ME]]), null);
  assert.equal(parse(ME, []), null);
  assert.equal(parse(PEER, []), null);
  assert.equal(parse(PEER, [['p', THIRD]]), null);
  assert.equal(parse(PEER, [['e', REQUEST_ID], ['p', ME], ['p', THIRD]], 7), null);
});

test('parseRumor ignores p tags that are not pubkeys', () => {
  const rumor = toRumor({ kind: 14, tags: [['p', ME], ['p', 'nonsense'], ['p'], ['p', PEER.toUpperCase()]], content: 'x', created_at: NOW });
  assert.equal(parseRumor(rumor, { me: ME })?.partner, PEER);
});

test('parseRumor returns null for a reaction without a usable target or emoji', () => {
  const parse = (tags, content) => parseRumor(toRumor({ kind: 7, tags, content, created_at: NOW }), { me: ME });
  assert.equal(parse([['p', ME]], '+'), null);
  assert.equal(parse([['p', ME], ['e', 'abc']], '+'), null);
  assert.equal(parse([['p', ME], ['e', REQUEST_ID]], ''), null);
  assert.equal(parse([['p', ME], ['e', REQUEST_ID]], 'x'.repeat(65)), null);
  assert.ok(parse([['p', ME], ['e', REQUEST_ID]], '+'));
});

test('a reaction targets the last e tag, as NIP-25 says', () => {
  const other = '1'.repeat(64);
  const rumor = toRumor({ kind: 7, tags: [['e', other], ['e', REQUEST_ID], ['p', ME]], content: '+', created_at: NOW });
  assert.equal(parseRumor(rumor, { me: ME }).reaction.targetId, REQUEST_ID);
});

// ---------------------------------------------------------------------------
// parseRumor: hostile and malformed input never throws
// ---------------------------------------------------------------------------

const valid = () => toRumor(buildTextTemplate({ recipient: ME, text: 'x', now }));

const MALFORMED_RUMORS = [
  undefined,
  null,
  'rumor',
  42,
  [],
  {},
  { ...valid(), id: 'abc' },
  { ...valid(), id: undefined },
  { ...valid(), pubkey: PEER.toUpperCase() },
  { ...valid(), pubkey: undefined },
  { ...valid(), kind: '14' },
  { ...valid(), kind: 14.5 },
  { ...valid(), created_at: '1' },
  { ...valid(), created_at: NaN },
  { ...valid(), content: 5 },
  { ...valid(), content: undefined },
  { ...valid(), tags: undefined },
  { ...valid(), tags: 'p' },
  { ...valid(), tags: [null] },
  { ...valid(), tags: ['p'] },
  { ...valid(), tags: [['p', 5]] },
  { ...valid(), tags: [[]] },
];

for (const rumor of MALFORMED_RUMORS) {
  test(`parseRumor returns null for the malformed rumor ${inspect(rumor, { depth: 1, breakLength: 200 }).slice(0, 70)}`, () => {
    assert.equal(parseRumor(rumor, { me: ME }), null);
  });
}

test('parseRumor returns null, without throwing, for a bad or missing me', () => {
  for (const context of [undefined, null, {}, { me: undefined }, { me: 'abc' }, { me: ME.toUpperCase() }, { me: 5 }]) {
    assert.equal(parseRumor(valid(), context), null);
  }
});

// ---------------------------------------------------------------------------
// parseRumor: degraded buho payloads
// ---------------------------------------------------------------------------

/** Assert the message is plain degraded text carrying the fallback content. */
function assertDegraded(message, content) {
  assert.ok(message, 'a degraded message is still delivered');
  assert.equal(message.type, 'text');
  assert.equal(message.degraded, true);
  assert.equal(message.text, content);
  assert.equal(message.request, null);
  assert.equal(message.status, null);
  assert.equal(message.payment, null);
  assert.equal(message.reaction, null);
}

// [description, mutate(tags) -> tags] applied to a valid request
const BAD_REQUEST_TAGS = [
  ['no lud16', swapTag('lud16', null)],
  ['a lud16 without a value', swapTag('lud16', ['lud16'])],
  ['an empty lud16', swapTag('lud16', ['lud16', ''])],
  ['a malformed lud16', swapTag('lud16', ['lud16', 'no spaces@allowed.io'])],
  ['a lud16 that is no address', swapTag('lud16', ['lud16', 'lnbc12000n1garbage'])],
  ['two lud16 tags', (tags) => [...tags, ['lud16', 'other@buho.example']]],
  ['no amount', swapTag('amount', null)],
  ['an amount of zero', swapTag('amount', ['amount', '0'])],
  ['a negative amount', swapTag('amount', ['amount', '-12000000'])],
  ['a fractional amount', swapTag('amount', ['amount', '12000000.5'])],
  ['an amount in exponent form', swapTag('amount', ['amount', '1.2e7'])],
  ['an amount with a leading zero', swapTag('amount', ['amount', '012000000'])],
  ['a sub-sat amount', swapTag('amount', ['amount', '12000500'])],
  ['an amount beyond safe integers', swapTag('amount', ['amount', '99999999999999999999'])],
  ['an empty amount', swapTag('amount', ['amount', ''])],
  ['two amounts', (tags) => [...tags, ['amount', '12000000']]],
  ['two notes', (tags) => [...tags, ['note', 'a'], ['note', 'b']]],
  ['a note over the limit', (tags) => [...tags, ['note', 'x'.repeat(MAX_NOTE_LENGTH + 1)]]],
  ['a buho tag with an extra element', swapTag('buho', ['buho', 'request', 'extra', '1'])],
  ['a buho tag without a type', swapTag('buho', ['buho', '1'])],
  ['a buho tag without a version', swapTag('buho', ['buho', 'request'])],
  ['an unknown version', swapTag('buho', ['buho', 'request', '2'])],
  ['an empty version', swapTag('buho', ['buho', 'request', ''])],
  ['a numeric-looking version', swapTag('buho', ['buho', 'request', '1.0'])],
  ['an unknown type', swapTag('buho', ['buho', 'invoice', '1'])],
  ['a type in the wrong case', swapTag('buho', ['buho', 'REQUEST', '1'])],
  ['a second buho tag', (tags) => [...tags, ['buho', 'request', '1']]],
  ['a second buho tag of another type', (tags) => [...tags, ['buho', 'payment', '1']]],
];

for (const [description, mutate] of BAD_REQUEST_TAGS) {
  test(`parseRumor degrades a request with ${description} to plain text`, () => {
    const template = requestTemplate({ note: 'Pizza' });
    const mutated = withTags(template, mutate);
    assertDegraded(received(mutated), template.content);
  });
}

test('a degraded request has no pay data and keeps the fallback content and reply link', () => {
  const template = requestTemplate();
  const mutated = withTags(template, (tags) => [...swapTag('amount', ['amount', '1'])(tags), ['e', REQUEST_ID, '', 'reply']]);
  const message = received(mutated);
  assertDegraded(message, template.content);
  assert.equal(message.replyTo, REQUEST_ID);
  assert.equal(message.id.length, 64);
});

// [description, mutate(tags) -> tags] applied to a valid paid status
const BAD_STATUS_TAGS = [
  ['an unknown value', swapTag('buho', ['buho', 'status', 'refunded', '1'])],
  ['no value', swapTag('buho', ['buho', 'status', '1'])],
  ['an unknown version', swapTag('buho', ['buho', 'status', 'paid', '2'])],
  ['no request link', swapTag('e', null)],
  ['a request link that is not a reply', swapTag('e', ['e', REQUEST_ID])],
  ['a malformed request id', swapTag('e', ['e', 'abc', '', 'reply'])],
  ['a malformed preimage', (tags) => [...tags, ['preimage', 'xyz']]],
  ['two preimages', (tags) => [...tags, ['preimage', PREIMAGE], ['preimage', PREIMAGE]]],
  ['a preimage on a declined status', swapTag('buho', ['buho', 'status', 'declined', '1'])],
];

for (const [description, mutate] of BAD_STATUS_TAGS) {
  test(`parseRumor degrades a status with ${description} to plain text`, () => {
    const base = buildStatusTemplate({ recipient: ME, requestId: REQUEST_ID, value: 'paid', preimage: PREIMAGE, now });
    assertDegraded(received(withTags(base, mutate)), base.content);
  });
}

// [description, mutate(tags) -> tags] applied to a valid payment
const BAD_PAYMENT_TAGS = [
  ['a malformed preimage', swapTag('preimage', ['preimage', PREIMAGE.slice(1)])],
  ['two preimages', (tags) => [...tags, ['preimage', PREIMAGE]]],
  ['no amount', swapTag('amount', null)],
  ['a fractional amount', swapTag('amount', ['amount', '5000.5'])],
  ['a sub-sat amount', swapTag('amount', ['amount', '5001'])],
  ['a note over the limit', swapTag('note', ['note', 'x'.repeat(MAX_NOTE_LENGTH + 1)])],
  ['an unknown version', swapTag('buho', ['buho', 'payment', '9'])],
  ['an extra buho element', swapTag('buho', ['buho', 'payment', 'x', '1'])],
];

for (const [description, mutate] of BAD_PAYMENT_TAGS) {
  test(`parseRumor degrades a payment with ${description} to plain text`, () => {
    const base = buildPaymentTemplate({ recipient: ME, amountSats: 5_000, note: 'Coffee', preimage: PREIMAGE, requestId: REQUEST_ID, now });
    assertDegraded(received(withTags(base, mutate)), base.content);
  });
}

test('a payment without a preimage tag is still a payment', () => {
  const base = buildPaymentTemplate({ recipient: ME, amountSats: 5, preimage: PREIMAGE, now });
  const message = received(withTags(base, swapTag('preimage', null)));
  assert.equal(message.type, 'payment');
  assert.equal(message.payment.preimage, null);
});

test('a payment whose request link is malformed is still a payment, just not linked', () => {
  const base = buildPaymentTemplate({ recipient: ME, amountSats: 5, preimage: PREIMAGE, requestId: REQUEST_ID, now });
  const message = received(withTags(base, swapTag('e', ['e', 'abc', '', 'reply'])));
  assert.equal(message.type, 'payment');
  assert.equal(message.payment.requestId, null);
});

test('parseRumor reads a buho tag only on kind 14, never on a reaction', () => {
  const rumor = toRumor({
    kind: 7,
    tags: [['e', REQUEST_ID], ['p', ME], ['buho', 'request', '1']],
    content: '+',
    created_at: NOW,
  });
  const message = parseRumor(rumor, { me: ME });
  assert.equal(message.type, 'reaction');
  assert.equal(message.degraded, false);
  assert.equal(message.request, null);
});

test('a message without a buho tag is plain text however much it looks like a request', () => {
  const template = requestTemplate();
  const message = received(withTags(template, swapTag('buho', null)));
  assert.equal(message.type, 'text');
  assert.equal(message.degraded, false);
  assert.equal(message.request, null);
  assert.equal(message.text, template.content);
});

test('a request from a peer cannot name another partner or recipient than the rumor does', () => {
  const message = received(requestTemplate());
  assert.equal(message.partner, PEER);
  assert.equal(message.sender, PEER);
  assert.equal(message.recipient, ME);
  assert.equal(message.outgoing, false);
});

test('parseRumor leaves its input untouched and returns fresh objects', () => {
  const rumor = toRumor(requestTemplate({ note: 'Pizza' }));
  const snapshot = structuredClone(rumor);
  const first = parseRumor(rumor, { me: ME });
  first.request.note = 'tampered';
  assert.deepEqual(rumor, snapshot);
  assert.equal(parseRumor(rumor, { me: ME }).request.note, 'Pizza');
});

test('parseRumor: a received request stays open at most the request lifetime', () => {
  const template = buildRequestTemplate({ recipient: ME, amountSats: 1_000, lud16: ADDRESS, now, validUntil: NOW + 10 * REQUEST_LIFETIME_SECONDS });
  assert.equal(received(template).request.validUntil, NOW + REQUEST_LIFETIME_SECONDS);
});

test('parseRumor: received text is cut to MAX_TEXT_LENGTH characters', () => {
  const long = { kind: 14, tags: [['p', ME]], content: 'x'.repeat(MAX_TEXT_LENGTH + 500), created_at: NOW };
  const text = received(long).text;
  assert.equal([...text].length, MAX_TEXT_LENGTH + 1);
  assert.ok(text.endsWith('…'));
});

test('containsSecretKey: a recovery phrase counts as a secret, ordinary words do not', () => {
  const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
  assert.equal(containsSecretKey(phrase), true);
  assert.equal(containsSecretKey(`Support here, please send ${phrase.toUpperCase()} to verify`), true);
  assert.equal(containsSecretKey('can you pay me back for the pizza we had last week with the others'), false);
});

test('a request or payment note with a secret is refused like a message text', () => {
  const nsec = nip19.nsecEncode(generateSecretKey());
  throwsCode(DM_ERROR.SECRET_KEY_IN_TEXT, () => buildRequestTemplate({ recipient: ME, amountSats: 1_000, lud16: ADDRESS, now, note: nsec }));
  throwsCode(DM_ERROR.SECRET_KEY_IN_TEXT, () => buildPaymentTemplate({ recipient: ME, amountSats: 1_000, now, note: `my key ${nsec}` }));
});

test('parseRumor: a text reply from another NIP-17 client (no marker) keeps its quote', () => {
  const reply = { kind: 14, tags: [['p', ME], ['e', REQUEST_ID, 'wss://relay.example.com']], content: 'sure', created_at: NOW };
  assert.equal(received(reply).replyTo, REQUEST_ID);
});
