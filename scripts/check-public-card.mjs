// Local UI check for the public card page (issue #301).
// Run against `npx quasar dev --port 9013` (PUBLIC_CARD_BASE_URL to override).
// Relays are answered by a scripted socket with one signed kind-0 event; no
// other outbound network is allowed, and nothing is ever paid.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-core';

const base = process.env.PUBLIC_CARD_BASE_URL || 'http://localhost:9013';
const output = 'output/public-card';
await mkdir(output, { recursive: true });

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const npub = nip19.npubEncode(pubkey);
const profileEvent = finalizeEvent({
  kind: 0,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: JSON.stringify({ name: 'Maria Test', lud16: 'maria@pay.invalid' }),
}, secret);

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

const expectedIntent =
  `intent://go.mybuho.de/p/${npub}#Intent;scheme=https;package=mybuho.buhogo;` +
  `S.browser_fallback_url=${encodeURIComponent('https://home.mybuho.de/buhogo')};end`;

// The full Chromium build (new headless) also covers machines that only
// downloaded it and not the separate headless shell.
const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'chromium' });
const results = [];

async function newPage(kind, { owner = false } = {}) {
  const mobile = kind !== 'desktop';
  const context = await browser.newContext({
    userAgent: UA[kind],
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**', (socket) => {
    const url = new URL(socket.url());
    if (url.host === new URL(base).host) { socket.connectToServer(); return; }
    // Any relay: answer REQs with the scripted profile, then EOSE.
    socket.onMessage((message) => {
      let parsed;
      try { parsed = JSON.parse(String(message)); } catch { return; }
      if (parsed[0] === 'REQ') {
        const [, subId, ...filters] = parsed;
        const wantsProfile = filters.some((f) => (f.kinds || []).includes(0) && (!f.authors || f.authors.includes(pubkey)));
        if (wantsProfile) socket.send(JSON.stringify(['EVENT', subId, profileEvent]));
        socket.send(JSON.stringify(['EOSE', subId]));
      }
    });
  });
  await page.addInitScript(({ owner, pubkey, npub }) => {
    window.__AUDIT__ = { noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
    if (owner) {
      localStorage.setItem('buhoGO_identity_v1', JSON.stringify({ version: 1, nostrPubkeyHex: pubkey, nostrNpub: npub, nostrAccountIndex: 0 }));
    }
  }, { owner, pubkey, npub });
  return { page, context, errors };
}

// Let the staggered entrance animation and the icons finish before a screenshot.
const settle = (page) => page.waitForTimeout(900);

async function waitForCard(page) {
  await page.locator('.pp-top-name', { hasText: 'Maria Test' }).waitFor();
}

function check(name, fn) {
  return fn().then(
    () => { results.push(`PASS ${name}`); },
    (err) => { results.push(`FAIL ${name}: ${err.message}`); },
  );
}

await check('android: Save and Open in BuhoGO hand off to the app; address bar is clean', async () => {
  const { page, context, errors } = await newPage('android');
  await page.goto(`${base}/p/${npub}`);
  await waitForCard(page);
  await page.waitForFunction(() => window.location.hash === '');
  assert.equal(await page.evaluate(() => window.location.pathname), `/p/${npub}`);

  const save = page.locator('a.pp-save[data-handoff="save"]');
  assert.equal(await save.getAttribute('href'), expectedIntent);
  assert.equal(await page.locator('a[data-handoff="open"]').getAttribute('href'), expectedIntent);
  assert.equal(await page.locator('a[href^="nostr:"]').count(), 0, 'no dead nostr: links');
  assert.match(await page.locator('.pp-cta').innerText(), /Pay Maria/);
  await settle(page); await page.screenshot({ path: `${output}/android-visitor.png` });

  // Reload the clean address: the shim restores the hash and the card renders.
  await page.reload();
  await waitForCard(page);
  await page.waitForFunction(() => window.location.hash === '');
  assert.equal(await page.evaluate(() => window.location.pathname), `/p/${npub}`);
  await settle(page); await page.screenshot({ path: `${output}/android-after-reload.png` });

  // In-app navigation leaves through the router's normal /#/ URLs …
  await page.evaluate(() => document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push('/about'));
  await page.waitForFunction(() => window.location.hash.startsWith('#/about'));
  assert.equal(await page.evaluate(() => window.location.pathname), '/');
  // … and Back renders the card again, clean address restored.
  await page.goBack();
  await waitForCard(page);
  await page.waitForFunction(() => window.location.hash === '');
  assert.equal(await page.evaluate(() => window.location.pathname), `/p/${npub}`);

  assert.deepEqual(errors, []);
  await context.close();
});

await check('android: the old hash link is cleaned too', async () => {
  const { page, context } = await newPage('android');
  await page.goto(`${base}/#/p/${npub}`);
  await waitForCard(page);
  await page.waitForFunction(() => window.location.hash === '');
  assert.equal(await page.evaluate(() => window.location.pathname + window.location.search), `/p/${npub}`);
  await context.close();
});

for (const kind of ['desktop', 'iphone']) {
  await check(`${kind}: Save explains where contacts live instead of a dead link`, async () => {
    const { page, context, errors } = await newPage(kind);
    await page.goto(`${base}/p/${npub}`);
    await waitForCard(page);
    await page.waitForFunction(() => window.location.hash === '');
    assert.equal(await page.locator('a[href^="intent:"]').count(), 0, 'no intent links off Android');
    assert.equal(await page.locator('a[href^="nostr:"]').count(), 0, 'no dead nostr: links');
    await page.locator('button.pp-save[data-handoff="help"]').click();
    const sheet = page.locator('.pp-save-help');
    await sheet.waitFor();
    assert.match(await sheet.innerText(), /Save Maria in BuhoGO/);
    assert.equal(await sheet.locator('a.pp-help-cta').getAttribute('href'), 'https://home.mybuho.de/buhogo');
    await page.waitForTimeout(400);
    await settle(page); await page.screenshot({ path: `${output}/${kind}-save-help.png` });
    assert.deepEqual(errors, []);
    await context.close();
  });
}

await check('owner: own link shows "This is your card", no Save and no Pay', async () => {
  const { page, context, errors } = await newPage('android', { owner: true });
  await page.goto(`${base}/p/${npub}`);
  await waitForCard(page);
  await page.locator('.pp-own-title', { hasText: 'This is your card' }).waitFor();
  assert.equal(await page.locator('.pp-save').count(), 0, 'no Save for the owner');
  assert.equal(await page.locator('.pp-cta', { hasText: /Pay/ }).count(), 0, 'no Pay {own name}');
  assert.equal(await page.locator('.pp-amount').count(), 0);
  assert.equal(await page.locator('.pp-own-badge').count(), 1);
  assert.equal(await page.locator('.pp-cta', { hasText: 'Share link' }).count(), 1);
  assert.equal(await page.locator('.pp-own-edit').count(), 1);
  assert.equal(await page.locator('.pp-foot').count(), 0, 'no "want a page like this" for the owner');
  await settle(page); await page.screenshot({ path: `${output}/owner.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

await check('another identity on the device is not the owner', async () => {
  const other = getPublicKey(generateSecretKey());
  const { page, context } = await newPage('desktop');
  await page.addInitScript(({ other, npubOther }) => {
    localStorage.setItem('buhoGO_identity_v1', JSON.stringify({ version: 1, nostrPubkeyHex: other, nostrNpub: npubOther, nostrAccountIndex: 0 }));
  }, { other, npubOther: nip19.npubEncode(other) });
  await page.goto(`${base}/p/${npub}`);
  await waitForCard(page);
  assert.equal(await page.locator('.pp-own-title').count(), 0);
  assert.equal(await page.locator('.pp-save').count(), 1);
  await context.close();
});

await browser.close();
console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
