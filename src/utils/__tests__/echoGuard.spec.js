/**
 * The deep-link echo guard.
 *
 * A cold start hands BuhoGO the launching link twice (getLaunchUrl and a
 * replayed appUrlOpen). The guard collapses that echo, and must let the same
 * link through again later: a guard that remembered the last link for good
 * made a second tap on a card link do nothing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEchoGuard } from '../echoGuard.js';

const LINK = 'https://go.mybuho.de/p/npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7?save=1';

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

await test('the first delivery is handled', () => {
  const { now } = clock();
  const isEcho = createEchoGuard({ windowMs: 2000, now });
  assert.equal(isEcho(LINK), false);
});

await test('the cold-start double delivery is collapsed', () => {
  const time = clock();
  const isEcho = createEchoGuard({ windowMs: 2000, now: time.now });
  assert.equal(isEcho(LINK), false);
  time.advance(40);
  assert.equal(isEcho(LINK), true);
});

await test('the same link opened again later goes through', () => {
  const time = clock();
  const isEcho = createEchoGuard({ windowMs: 2000, now: time.now });
  assert.equal(isEcho(LINK), false);
  time.advance(2000);
  assert.equal(isEcho(LINK), false);
  time.advance(60_000);
  assert.equal(isEcho(LINK), false);
});

await test('an echo does not stretch the window', () => {
  const time = clock();
  const isEcho = createEchoGuard({ windowMs: 2000, now: time.now });
  assert.equal(isEcho(LINK), false);
  time.advance(1500);
  assert.equal(isEcho(LINK), true);
  time.advance(600);
  assert.equal(isEcho(LINK), false);
});

await test('a different link is never an echo, and becomes the one to compare', () => {
  const time = clock();
  const isEcho = createEchoGuard({ windowMs: 2000, now: time.now });
  assert.equal(isEcho(LINK), false);
  time.advance(10);
  assert.equal(isEcho('lightning:maria@mybuho.de'), false);
  time.advance(10);
  assert.equal(isEcho(LINK), false);
});

console.log('\n5 passed, 0 failed');
