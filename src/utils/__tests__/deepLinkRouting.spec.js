/**
 * Deep-link routing decisions (issue #301): Nostr identities open the card,
 * payments keep their path, and a repeated tap is handled.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { cardRouteForDeepLink, createDeepLinkDeduper, DEEP_LINK_DEDUPE_MS } from '../deepLinkRouting.js';

const NPUB = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';
const NPROFILE = 'nprofile1qqsw308nsgmxj3zdpdy663wk2zyx8mulmpgq5ad47g94n2l044dpgnchl3h4r';

await test('nostr:npub opens the card, not the pay sheet', () => {
  assert.deepEqual(cardRouteForDeepLink(`nostr:${NPUB}`), { path: `/p/${NPUB}`, query: {} });
  assert.deepEqual(cardRouteForDeepLink(`NOSTR:${NPUB}`), { path: `/p/${NPUB}`, query: {} });
  assert.deepEqual(cardRouteForDeepLink(`  nostr:${NPUB}\n`), { path: `/p/${NPUB}`, query: {} });
});

await test('nostr:nprofile opens the card too', () => {
  assert.deepEqual(cardRouteForDeepLink(`nostr:${NPROFILE}`), { path: `/p/${NPROFILE}`, query: {} });
});

await test('shared card links still open the card', () => {
  assert.deepEqual(cardRouteForDeepLink(`https://go.mybuho.de/p/${NPUB}`), { path: `/p/${NPUB}`, query: {} });
  assert.deepEqual(cardRouteForDeepLink(`https://go.mybuho.de/p/maria?k=${NPUB}`), { path: '/p/maria', query: { k: NPUB } });
});

await test('payments and other Nostr links keep their payment handling', () => {
  for (const url of [
    'lightning:maria@mybuho.de',
    'lightning:lnbc10u1p0examplexyz',
    'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'lnurlp://mybuho.de/.well-known/lnurlp/maria',
    'nostr:nevent1qqstna2yrezu5wghjvswqqculvvwxsrcvu7uc0f78gan4xqhvz49d9spr3mhxue69uhkummnw3ez6un9d3shjtn4de6x2argwghx6egpr4mhxue69uhkummnw3ez6ur4vgh8wetvd3hhyer9wghxuet5nxnepm',
    'nostr:nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5',
    'nostr+walletconnect://abc?relay=wss://relay.example&secret=00',
    `${NPUB}`,
    'https://example.com/p',
    '',
    null,
  ]) {
    assert.equal(cardRouteForDeepLink(url), null, String(url));
  }
});

await test('the same URL twice inside the window is one delivery', () => {
  let t = 1_000;
  const shouldHandle = createDeepLinkDeduper({ now: () => t });
  assert.equal(shouldHandle('nostr:a'), true);
  t += 50;
  assert.equal(shouldHandle('nostr:a'), false);
});

await test('a second tap on the same link later is handled (it used to be ignored forever)', () => {
  let t = 1_000;
  const shouldHandle = createDeepLinkDeduper({ now: () => t });
  assert.equal(shouldHandle('nostr:a'), true);
  t += DEEP_LINK_DEDUPE_MS;
  assert.equal(shouldHandle('nostr:a'), true);
  t += DEEP_LINK_DEDUPE_MS * 30;
  assert.equal(shouldHandle('nostr:a'), true);
});

await test('different URLs are never deduped', () => {
  const shouldHandle = createDeepLinkDeduper({ now: () => 5 });
  assert.equal(shouldHandle('nostr:a'), true);
  assert.equal(shouldHandle('nostr:b'), true);
  assert.equal(shouldHandle('nostr:a'), true);
  assert.equal(shouldHandle(''), false);
});

await test('the default window is short', () => {
  assert.ok(DEEP_LINK_DEDUPE_MS > 0 && DEEP_LINK_DEDUPE_MS <= 3000);
});
