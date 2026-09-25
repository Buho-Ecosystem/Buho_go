/**
 * Profile links, both directions.
 *
 * `parseProfileLink` lets every card link (the shared link and the card's
 * save code) enter the same contact resolver, whether it arrives by scan,
 * paste or Android intent. The save link and the web card's Android Save are
 * built here too.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProfileLink,
  buildSaveLink,
  buildAndroidSaveIntent,
  parseProfileLink,
  profileLinkRoute,
  profileSlug,
  expandProfileSlug,
  isKey,
  isSaveFlag,
  ANDROID_PACKAGE,
  BUHOGO_HOME,
  PROFILE_PATH,
  PUBLIC_WEB_ORIGIN,
} from '../profileLink.js';

const NPUB = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';

await test('buildProfileLink leads with the key, which needs no network to resolve', () => {
  const link = buildProfileLink({ username: 'maria', npub: NPUB });
  assert.equal(link, `${PUBLIC_WEB_ORIGIN}${PROFILE_PATH}${NPUB}`);
});

await test('buildProfileLink falls back to the username when no key is known', () => {
  const link = buildProfileLink({ username: 'maria' });
  assert.equal(link, `${PUBLIC_WEB_ORIGIN}${PROFILE_PATH}maria`);
});

await test('buildProfileLink with only a key does not append the key to itself', () => {
  const link = buildProfileLink({ npub: NPUB });
  assert.equal(link, `${PUBLIC_WEB_ORIGIN}${PROFILE_PATH}${NPUB}`);
});

await test('buildProfileLink returns empty when there is nothing to point at', () => {
  assert.equal(buildProfileLink({}), '');
  assert.equal(buildProfileLink(), '');
});

await test('a link built from a card parses back to something resolvable', () => {
  const link = buildProfileLink({ username: 'maria', npub: NPUB });
  assert.equal(parseProfileLink(link), NPUB);
});

await test('parseProfileLink prefers the key, which needs no network', () => {
  // The username would need a NIP-05 lookup against a domain that can be down.
  // The key resolves locally, so when the link carries both, the key wins.
  assert.equal(parseProfileLink(`${PUBLIC_WEB_ORIGIN}/p/maria?k=${NPUB}`), NPUB);
});

await test('parseProfileLink expands a bare username to its NIP-05 address', () => {
  const out = parseProfileLink(`${PUBLIC_WEB_ORIGIN}/p/maria`);
  assert.match(out, /^maria@/);
});

await test('parseProfileLink keeps a full address slug as-is', () => {
  assert.equal(parseProfileLink(`${PUBLIC_WEB_ORIGIN}/p/maria@example.com`), 'maria@example.com');
});

await test('parseProfileLink reads a key slug directly', () => {
  assert.equal(parseProfileLink(`${PUBLIC_WEB_ORIGIN}/p/${NPUB}`), NPUB);
});

await test('parseProfileLink decodes a percent-encoded slug', () => {
  assert.equal(
    parseProfileLink(`${PUBLIC_WEB_ORIGIN}/p/maria%40example.com`),
    'maria@example.com',
  );
});

await test('parseProfileLink ignores anything that is not a profile link', () => {
  for (const value of [
    '',
    null,
    undefined,
    'nostr:npub1abc',
    'maria@walletofsatoshi.com',
    'lightning:maria@npub.cash',
    'lnbc10n1pjqxyz',
    `${PUBLIC_WEB_ORIGIN}/`,
    `${PUBLIC_WEB_ORIGIN}/wallet`,
    'not a url at all',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(parseProfileLink(value), '', `should not parse: ${String(value)}`);
  }
});

await test('parseProfileLink accepts the same path from any host it is served on', () => {
  // Preview deploys and local dev serve the identical page; a code that only
  // scanned in production would be untestable everywhere else.
  assert.equal(parseProfileLink(`https://deploy-preview.example.com/p/${NPUB}`), NPUB);
});

await test('parseProfileLink rejects a profile path with an empty slug', () => {
  assert.equal(parseProfileLink(`${PUBLIC_WEB_ORIGIN}/p/`), '');
  assert.equal(parseProfileLink(`${PUBLIC_WEB_ORIGIN}/p/%20`), '');
});

await test('profileSlug and expandProfileSlug round-trip a username when no key is known', () => {
  const slug = profileSlug({ username: 'maria' });
  assert.equal(slug, 'maria');
  assert.match(expandProfileSlug(slug), /^maria@/);
});

await test('isKey only accepts the local-resolving forms', () => {
  assert.equal(isKey(NPUB), true);
  assert.equal(isKey('nprofile1abc'), true);
  assert.equal(isKey('maria@example.com'), false);
  assert.equal(isKey(''), false);
});

// ── App Link routing ────────────────────────────────────────────────────────
// Android hands the app the same https URL the browser would have opened.
// These decide whether it lands on the card or falls through to the payment
// parser, which would be the wrong screen entirely.

await test('profileLinkRoute keeps the slug and the fallback key', () => {
  const route = profileLinkRoute(`${PUBLIC_WEB_ORIGIN}/p/maria?k=${NPUB}`);
  assert.deepEqual(route, { path: '/p/maria', query: { k: NPUB } });
});

await test('profileLinkRoute omits the query when there is no key', () => {
  assert.deepEqual(profileLinkRoute(`${PUBLIC_WEB_ORIGIN}/p/${NPUB}`), {
    path: `/p/${NPUB}`,
    query: {},
  });
});

await test('profileLinkRoute encodes a slug that is a full address', () => {
  const route = profileLinkRoute(`${PUBLIC_WEB_ORIGIN}/p/maria@example.com`);
  assert.equal(route.path, '/p/maria%40example.com');
});

await test('profileLinkRoute drops a fallback key that is not a key', () => {
  const route = profileLinkRoute(`${PUBLIC_WEB_ORIGIN}/p/maria?k=not-a-key`);
  assert.deepEqual(route.query, {});
});

await test('malformed percent-encoding never throws, it is simply not ours', () => {
  // Both consumers are hostile-input paths: the camera scanner and the
  // Android intent handler. decodeURIComponent raises URIError on %ZZ, and
  // an exception here crashes a scan callback mid-frame.
  for (const bad of [
    `${PUBLIC_WEB_ORIGIN}/p/%ZZ`,
    `${PUBLIC_WEB_ORIGIN}/p/%E0%A4%A`,
    `${PUBLIC_WEB_ORIGIN}/p/maria%`,
  ]) {
    assert.equal(parseProfileLink(bad), '', bad);
    assert.equal(profileLinkRoute(bad), null, bad);
  }
});

await test('profileLinkRoute returns null for anything the payment parser owns', () => {
  for (const value of [
    'lightning:maria@npub.cash',
    'bitcoin:bc1qexample',
    'nostr:npub1abc',
    `${PUBLIC_WEB_ORIGIN}/wallet`,
    'https://example.com/settings',
    '',
  ]) {
    assert.equal(profileLinkRoute(value), null, `should not route: ${value}`);
  }
});

// ── Save links ──────────────────────────────────────────────────────────────
// `nostr:npub` means "pay" in BuhoGO, so the codes captioned "scan to save"
// carry the card link with a save flag instead. The card saves on arrival
// only for a key in the path, which is why these are only ever built on one.

await test('buildSaveLink is the key-led card link with the save flag', () => {
  assert.equal(buildSaveLink(NPUB), `${PUBLIC_WEB_ORIGIN}${PROFILE_PATH}${NPUB}?save=1`);
});

await test('buildSaveLink builds on a canonical npub only', () => {
  for (const value of [
    '',
    null,
    undefined,
    'maria',
    'maria@mybuho.de',
    `nostr:${NPUB}`,
    NPUB.toUpperCase(),
    NPUB.slice(0, -1),
    `${NPUB}x`,
    'nprofile1qqsw3dy8cpumpanud9dwd3xz254y0uu2m739x0x9jf4a9sgzjshaedcpr4mhxue69uhkummnw3ez6ur4vgh8wetvd3hhyer9wghxuet5nxnepm',
    'npub1;package=evil;end',
  ]) {
    assert.equal(buildSaveLink(value), '', `should not build: ${String(value)}`);
  }
});

await test('a save link opens the card for that key, with the flag', () => {
  const link = buildSaveLink(NPUB);
  assert.equal(parseProfileLink(link), NPUB);
  assert.deepEqual(profileLinkRoute(link), { path: `/p/${NPUB}`, query: { save: '1' } });
});

await test('profileLinkRoute keeps the save flag only in its one spelling', () => {
  for (const flag of ['true', 'yes', '0', '', '1 ', '01', 'save']) {
    const route = profileLinkRoute(`${PUBLIC_WEB_ORIGIN}/p/${NPUB}?save=${encodeURIComponent(flag)}`);
    assert.deepEqual(route.query, {}, `flag "${flag}" should be dropped`);
  }
});

await test('profileLinkRoute carries the fallback key and the save flag together', () => {
  const route = profileLinkRoute(`${PUBLIC_WEB_ORIGIN}/p/maria?k=${NPUB}&save=1`);
  assert.deepEqual(route, { path: '/p/maria', query: { k: NPUB, save: '1' } });
});

await test('isSaveFlag accepts exactly the string "1"', () => {
  assert.equal(isSaveFlag('1'), true);
  for (const value of [1, true, 'true', ['1'], '1 ', '', null, undefined]) {
    assert.equal(isSaveFlag(value), false, `should not accept: ${JSON.stringify(value)}`);
  }
});

// ── The web card's Save on Android ──────────────────────────────────────────

await test('buildAndroidSaveIntent hands the save link to the BuhoGO package', () => {
  assert.equal(
    buildAndroidSaveIntent(NPUB),
    `intent://go.mybuho.de/p/${NPUB}?save=1#Intent;scheme=https;package=${ANDROID_PACKAGE};`
      + `S.browser_fallback_url=${encodeURIComponent(BUHOGO_HOME)};end`,
  );
});

await test('the intent carries exactly scheme, package and an https fallback', () => {
  const intent = buildAndroidSaveIntent(NPUB);
  const [target, fields] = intent.split('#Intent;');
  assert.equal(target, `intent://go.mybuho.de/p/${NPUB}?save=1`);
  const parts = fields.split(';');
  assert.deepEqual(parts.map((part) => part.split('=')[0]), [
    'scheme',
    'package',
    'S.browser_fallback_url',
    'end',
  ]);
  const fallback = decodeURIComponent(parts[2].slice('S.browser_fallback_url='.length));
  assert.equal(new URL(fallback).protocol, 'https:');
});

await test('buildAndroidSaveIntent refuses anything that could add intent fields', () => {
  for (const value of [
    '',
    'maria',
    'npub1;package=evil;end',
    `${NPUB}#Intent;component=evil;end`,
    `${NPUB};S.browser_fallback_url=javascript:alert(1)`,
  ]) {
    assert.equal(buildAndroidSaveIntent(value), '', `should not build: ${value}`);
  }
});

console.log('\n30 passed, 0 failed');
