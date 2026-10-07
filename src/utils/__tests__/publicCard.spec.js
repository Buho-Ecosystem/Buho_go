/**
 * Public card page helpers (issue #301): the Android "Open in BuhoGO"
 * handoff, platform detection, own-card detection and the clean address.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_PACKAGE,
  buildAppHandoffUrl,
  cardUrl,
  cleanCardAddress,
  hashCardAddress,
  isAndroidBrowser,
  isOwnCard,
} from '../publicCard.js';
import { BUHOGO_HOME, profileLinkRoute } from '../profileLink.js';

const NPUB = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';
const HEX = 'e8bcf3823669444d0b49ad45d6508863ef9fd8500a75b5f20b59abefad5a144f';

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

await test('the package matches the Android applicationId', () => {
  assert.equal(APP_PACKAGE, 'mybuho.buhogo');
});

await test('cardUrl is always on the production origin, the one the App Link claims', () => {
  assert.equal(cardUrl(NPUB), `https://go.mybuho.de/p/${NPUB}`);
  assert.equal(cardUrl('maria', NPUB), `https://go.mybuho.de/p/maria?k=${NPUB}`);
  assert.equal(cardUrl('maria', 'not-a-key'), 'https://go.mybuho.de/p/maria');
  assert.equal(cardUrl(''), '');
});

await test('buildAppHandoffUrl aims at the BuhoGO package and falls back to the download page', () => {
  const intent = buildAppHandoffUrl(cardUrl(NPUB));
  assert.equal(
    intent,
    `intent://go.mybuho.de/p/${NPUB}#Intent;scheme=https;package=mybuho.buhogo;` +
      `S.browser_fallback_url=${encodeURIComponent(BUHOGO_HOME)};end`,
  );
});

await test('buildAppHandoffUrl keeps the fallback key, so the app opens the same card', () => {
  const intent = buildAppHandoffUrl(cardUrl('maria', NPUB));
  assert.match(intent, /^intent:\/\/go\.mybuho\.de\/p\/maria\?k=npub1[^#]+#Intent;/);
  // What the app receives is the https URL; it must route to the same card.
  const received = `https://${intent.slice('intent://'.length, intent.indexOf('#'))}`;
  assert.deepEqual(profileLinkRoute(received), { path: '/p/maria', query: { k: NPUB } });
});

await test('buildAppHandoffUrl refuses anything that is not a web URL', () => {
  assert.equal(buildAppHandoffUrl(`nostr:${NPUB}`), '');
  assert.equal(buildAppHandoffUrl('javascript:alert(1)'), '');
  assert.equal(buildAppHandoffUrl(''), '');
});

await test('only Android browsers get the intent link', () => {
  assert.equal(isAndroidBrowser(ANDROID_CHROME), true);
  assert.equal(isAndroidBrowser(IPHONE), false);
  assert.equal(isAndroidBrowser(DESKTOP), false);
  assert.equal(isAndroidBrowser(undefined), false);
});

await test('isOwnCard matches on the hex key, case-insensitively', () => {
  assert.equal(isOwnCard({ pubkey: HEX, npub: NPUB }, { nostrPubkeyHex: HEX.toUpperCase(), nostrNpub: NPUB }), true);
  assert.equal(isOwnCard({ pubkey: HEX }, { nostrPubkeyHex: 'f'.repeat(64), nostrNpub: null }), false);
});

await test('isOwnCard falls back to the npub, and is false with no identity', () => {
  assert.equal(isOwnCard({ npub: NPUB }, { nostrNpub: NPUB }), true);
  assert.equal(isOwnCard({ pubkey: HEX, npub: NPUB }, { nostrPubkeyHex: null, nostrNpub: null }), false);
  assert.equal(isOwnCard({ pubkey: '', npub: '' }, { nostrPubkeyHex: '', nostrNpub: '' }), false);
  assert.equal(isOwnCard(null, null), false);
});

await test('cleanCardAddress turns the hash route into the path an App Link matches', () => {
  assert.equal(cleanCardAddress(`#/p/${NPUB}`), `/p/${NPUB}`);
  assert.equal(cleanCardAddress(`#/p/maria?k=${NPUB}`), `/p/maria?k=${NPUB}`);
  assert.equal(cleanCardAddress('#/wallet'), '');
  assert.equal(cleanCardAddress('#/p/'), '');
  assert.equal(cleanCardAddress(''), '');
});

await test('hashCardAddress puts the hash back for the router, and only when needed', () => {
  assert.equal(hashCardAddress(`/p/${NPUB}`, '', ''), `/#/p/${NPUB}`);
  assert.equal(hashCardAddress('/p/maria', `?k=${NPUB}`, ''), `/#/p/maria?k=${NPUB}`);
  assert.equal(hashCardAddress('/', '', `#/p/${NPUB}`), '');
  assert.equal(hashCardAddress(`/p/${NPUB}`, '', '#/wallet'), '');
});

await test('clean and hash forms round-trip', () => {
  const hash = `#/p/maria?k=${NPUB}`;
  const clean = cleanCardAddress(hash);
  const [pathname, search] = [clean.split('?')[0], `?${clean.split('?')[1]}`];
  assert.equal(hashCardAddress(pathname, search, ''), `/${hash}`);
});
