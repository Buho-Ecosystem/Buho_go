/**
 * Reading the phone number in a `tel:` link (RFC 3966), strictly.
 *
 * Run: node --test src/utils/__tests__/telUri.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTelUri, parseTelUri } from '../telUri.js';

test('a global number, as QR codes write one', () => {
  assert.deepEqual(parseTelUri('tel:+254712345678'), { number: '+254712345678', phoneContext: null });
  assert.deepEqual(parseTelUri('tel:+1-212-555-1212'), { number: '+1-212-555-1212', phoneContext: null }, 'the RFC\'s visual separators');
  assert.deepEqual(parseTelUri('tel:+254(712)345.678'), { number: '+254(712)345.678', phoneContext: null });
});

test('in any case, the text trimmed', () => {
  for (const text of ['TEL:+254712345678', 'Tel:+254712345678', '  tel:+254712345678\n']) {
    assert.equal(parseTelUri(text)?.number, '+254712345678', JSON.stringify(text));
  }
  assert.equal(parseTelUri('tel:0712345678;PHONE-CONTEXT=+254')?.phoneContext, '+254', 'the parameter name too');
});

test('a local number, with the context the RFC requires of it', () => {
  assert.deepEqual(parseTelUri('tel:0712345678;phone-context=+254'), { number: '0712345678', phoneContext: '+254' });
  assert.deepEqual(parseTelUri('tel:863-1234;phone-context=+1-914-555'), { number: '863-1234', phoneContext: '+1-914-555' }, 'the RFC\'s own example');
});

test('a local number without a context, or with a domain for one, is not read', () => {
  for (const text of ['tel:0712345678', 'tel:0723891234', 'tel:7042;phone-context=example.com', 'tel:0712345678;phone-context=254']) {
    assert.equal(parseTelUri(text), null, text);
  }
});

test('what reaches past the number, or is not in the RFC\'s form, is not read', () => {
  for (const text of [
    'tel:+254712345678;ext=101',
    'tel:+254712345678;isub=1411',
    'tel:+254712345678;foo=bar',
    'tel:0712345678;phone-context=+254;ext=1',
    'tel:0712345678;ext=1;phone-context=+254',
    'tel:0712345678;phone-context=+254;phone-context=+260',
    'tel:+254712345678;phone-context=+254',
    'tel:+254 712 345 678',
    'tel:%2B254712345678',
    'tel://+254712345678',
    'tel:+254712345678?body=hi',
    'tel:0712345678;phone-context=+254 ?x',
    'tel:0712345678;phone-context=+254?body=hi',
    'tel:0712345678;phone-context=%2B254',
    'tel:0712345678;phone-context=+254\nx',
    'tel:0712345678;phone-context=+',
    'tel:0712345678;phone-context=+--',
    'tel:0712345678;phone-context=',
    'tel:*123#',
    'tel:+254712ABC678',
    'tel:+',
    'tel:+---',
    'tel:',
  ]) {
    assert.equal(parseTelUri(text), null, JSON.stringify(text));
  }
});

test('anything that is not a tel: link is not one', () => {
  for (const value of ['+254712345678', '0712345678', 'sms:+254712345678', 'mailto:a@example.com', 'telephone:+254712345678', 'xtel:+254712345678', 'lightning:tel:+254712345678', null, undefined, 254712345678, {}]) {
    assert.equal(parseTelUri(value), null, String(value));
    assert.equal(isTelUri(value), false, String(value));
  }
});

test('isTelUri says whether it is a tel: link at all, readable or not', () => {
  assert.equal(isTelUri('tel:+254712345678'), true);
  assert.equal(isTelUri(' TEL:+254 712 345 678 '), true);
  assert.equal(isTelUri('tel:0712345678'), true);
  assert.equal(isTelUri('tel:+254712345678;ext=1'), true);
});

test('a long hostile text is answered at once', () => {
  for (const text of [
    `tel:+${'('.repeat(40000)}x`,
    `tel:${'1'.repeat(40000)};phone-context=${';'.repeat(40000)}`,
    `tel:${'0-'.repeat(20000)};phone-context=+${'-'.repeat(40000)}x`,
    `tel:${'0'.repeat(40000)};phone-context=+${'0'.repeat(40000)};`,
  ]) {
    const started = performance.now();
    parseTelUri(text);
    assert.ok(performance.now() - started < 50, `${text.slice(0, 20)}...`);
  }
});
