/**
 * The per-person link preview, against both shapes of index.html.
 *
 * The trap this spec exists for: the build minifies index.html and drops
 * attribute quotes, so `<meta property="og:title">` ships as
 * `<meta property=og:title>`. A replacement pattern written for the quoted
 * source form matches nothing in production and fails silently — the preview
 * simply stays generic and no error is ever thrown. Every assertion here runs
 * twice, once per shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import profilePreview from '../profile-preview.js';

/** The head as it exists in the repo. */
const SOURCE_HEAD = `<!DOCTYPE html><html><head>
  <title>BuhoGO</title>
  <meta name="title" content="BuhoGO"/>
  <meta name="description" content="The simple Bitcoin wallet."/>
  <meta property="og:url" content="https://go.mybuho.de/"/>
  <meta property="og:title" content="BuhoGO"/>
  <meta property="og:description" content="The simple Bitcoin wallet."/>
  <meta property="og:image" content="https://go.mybuho.de/og/site-card.jpg"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:alt" content="BuhoGO."/>
  <meta property="twitter:url" content="https://go.mybuho.de/"/>
  <meta property="twitter:title" content="BuhoGO"/>
  <meta property="twitter:description" content="The simple Bitcoin wallet."/>
  <meta property="twitter:image" content="https://go.mybuho.de/og/site-card.jpg"/>
</head><body></body></html>`;

/** The same head as the minifier ships it: quotes gone where values allow. */
const BUILT_HEAD = SOURCE_HEAD
  .replace(/\n\s*/g, '')
  .replace(/(name|property)="([^"]+)"/g, '$1=$2')
  .replace(/content="([^" ]+)"/g, 'content=$1');

async function run(html, url) {
  const context = {
    next: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
  };
  const response = await profilePreview(new Request(url), context);
  return response.text();
}

for (const [shape, html] of [['source', SOURCE_HEAD], ['built', BUILT_HEAD]]) {
  await test(`${shape}: a named link gets the person's tags, once each`, async () => {
    const out = await run(html, 'https://go.mybuho.de/p/maria?k=npub1abc');

    assert.deepEqual(out.match(/<title>[^<]*<\/title>/g), ['<title>@maria on BuhoGO</title>']);
    assert.match(out, /<meta property="og:title" content="@maria on BuhoGO"\/>/);
    assert.match(out, /<meta property="og:image" content="https:\/\/go\.mybuho\.de\/og\/profile-card\.jpg"\/>/);
    assert.match(out, /<meta property="og:image:alt" content="@maria(?:&#?\w+;|')s BuhoGO card"\/>/);
    // Canonical strips the query: the key is a fallback, not part of the address.
    assert.match(out, /<meta property="og:url" content="https:\/\/go\.mybuho\.de\/p\/maria"\/>/);
    // Nothing generic survives on a person's link.
    assert.ok(!out.includes('site-card.jpg'), 'site image must not leak onto /p/');
  });

  await test(`${shape}: og:image:width is not collateral of the og:image pattern`, async () => {
    const out = await run(html, 'https://go.mybuho.de/p/maria');
    assert.match(out, /og:image:width["']? content=["']?1200/);
  });

  await test(`${shape}: a key-only link gets the generic card wording`, async () => {
    const out = await run(html, 'https://go.mybuho.de/p/npub1az708q3kd9zy6z6f44z');
    assert.match(out, /<title>A BuhoGO card<\/title>/);
  });

  await test(`${shape}: outside /p/ the page passes through untouched`, async () => {
    const out = await run(html, 'https://go.mybuho.de/wallet');
    assert.equal(out, html);
  });

  await test(`${shape}: a hostile slug cannot break out of the attribute`, async () => {
    const out = await run(html, 'https://go.mybuho.de/p/%22%3E%3Cscript%3E');
    assert.ok(!out.includes('"><script>'), 'slug must be escaped');
  });
}

await test('non-HTML responses pass through untouched', async () => {
  const context = {
    next: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
  };
  const response = await profilePreview(new Request('https://go.mybuho.de/p/maria'), context);
  assert.equal(await response.text(), '{}');
});

console.log('\n11 passed, 0 failed');
