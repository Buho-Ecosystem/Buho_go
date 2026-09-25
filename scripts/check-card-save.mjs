/** Card save links, in the browser. Start `npx quasar dev --port 9016` first.
 * Relays and NIP-05 are mocked with profiles signed by throwaway test keys;
 * every other external request is blocked. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bech32 } from 'bech32';
import { mkdir } from 'node:fs/promises';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-core';

const base = process.env.CARD_SAVE_BASE_URL || 'http://127.0.0.1:9016';
const output = process.env.CARD_SAVE_OUTPUT || '/private/tmp/card-save-review';
await mkdir(output, { recursive: true });

const HOME = 'https://home.mybuho.de/buhogo';

// Throwaway keys derived from fixed labels, so every run signs the same events.
function person(label, content) {
  const secret = createHash('sha256').update(`buhogo-card-save-check:${label}`).digest();
  const pubkey = getPublicKey(secret);
  const event = finalizeEvent({ kind: 0, created_at: 1760000000, tags: [], content: JSON.stringify(content) }, secret);
  return { pubkey, npub: nip19.npubEncode(pubkey), event, name: content.name };
}

const viewer = person('viewer', { name: 'Viewer' });
const maria = person('maria', { name: 'Maria', lud16: 'maria@example.com' });
const bob = person('bob', { name: 'Bob' });
const carol = person('carol', { name: 'Carol', nip05: 'carol@example.com' });
const dave = person('dave', { name: 'Dave' });
const erin = person('erin', { name: 'Erin' });
const frank = person('frank', { name: 'Frank', lud16: 'frank@example.com' });
const grace = person('grace', { name: 'Grace', lud16: 'grace@example.com' });
const henry = person('henry', { name: 'Henry' });
const ivy = person('ivy', { name: 'Ivy' });
const profiles = new Map([viewer, maria, bob, carol, dave, erin, frank, grace, henry, ivy].map((p) => [p.pubkey, p.event]));
// These relays answer late, inside the fetch timeout: long enough for another
// card to finish loading, or for the viewer to leave, before they land.
const slow = new Set([frank.pubkey, henry.pubkey]);

const saveLink = (p) => `${base}/p/${p.npub}?save=1`;

const browser = await chromium.launch({ headless: true });
const errors = [];

async function openContext({ withWallet, userAgent }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(userAgent ? { userAgent } : {}) });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.hostname === 'api.iconify.design' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) return route.continue();
    if (url.hostname === 'example.com' && url.pathname === '/.well-known/nostr.json') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ names: { carol: carol.pubkey } }) });
    }
    return route.abort();
  });
  // Every relay answers from the signed profiles above, then EOSE.
  await page.routeWebSocket(/.*/, (ws) => {
    ws.onMessage((raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message[0] === 'REQ') {
        const [, subId, ...filters] = message;
        const events = filters
          .filter((filter) => (filter.kinds || []).includes(0))
          .flatMap((filter) => (filter.authors || []).map((author) => profiles.get(author)).filter(Boolean));
        const reply = () => {
          for (const event of events) ws.send(JSON.stringify(['EVENT', subId, event]));
          ws.send(JSON.stringify(['EOSE', subId]));
        };
        if (events.some((event) => slow.has(event.pubkey))) setTimeout(reply, 2000);
        else reply();
      } else if (message[0] === 'EVENT') {
        ws.send(JSON.stringify(['OK', message[1]?.id, true, '']));
      }
    });
  });
  await page.addInitScript(({ viewer, withWallet }) => {
    window.__AUDIT__ = { theme: 'light' };
    localStorage.setItem('buhoGO_language', 'en-US');
    if (withWallet) {
      localStorage.setItem('buhoGO_identity_seed_v1', 'public-test-fixture-not-a-seed');
      localStorage.setItem('buhoGO_identity_v1', JSON.stringify({ version: 1, nostrPubkeyHex: viewer.pubkey, nostrNpub: viewer.npub, nostrAccountIndex: 0, connectedSites: [] }));
      localStorage.setItem('buhoGO_wallet_store', JSON.stringify({
        wallets: [{ id: 'w-spark', type: 'spark', name: 'Personal wallet', metadata: {}, connectionData: { encryptedMnemonic: 'audit-fixture-not-a-seed' } }],
        activeWalletId: 'w-spark',
        biometricsEnabled: false,
      }));
    }
  }, { viewer: { pubkey: viewer.pubkey, npub: viewer.npub }, withWallet });
  return { context, page };
}

const store = (page, id) => page.evaluate((id) => window.__audit.app.config.globalProperties.$pinia._s.get(id) != null, id);
const contactKeys = (page) => page.evaluate(() => (window.__audit.app.config.globalProperties.$pinia._s.get('addressBook')?.entries || []).map((e) => e.nostr_pubkey).filter(Boolean));
const push = (page, path) => page.evaluate((path) => window.__audit.app.config.globalProperties.$router.push(path), path);
const hash = (page) => page.evaluate(() => location.hash);
const setLocked = (page, locked) => page.evaluate((locked) => { window.__audit.app._instance.proxy.locked = locked; }, locked);
const toast = (page, text) => page.getByText(text, { exact: true }).first().waitFor({ timeout: 10000 });
const cardName = (page, name) => page.locator('.pp-top-name', { hasText: name }).waitFor({ timeout: 15000 });

const askTitle = (page) => page.locator('.pp-ask-title');
const asking = (page, question) => page.locator('.pp-ask-title', { hasText: question }).waitFor({ timeout: 15000 });
const notAsking = async (page) => assert.equal(await askTitle(page).isVisible(), false, 'no save question expected');

// Find the Send sheet's component, to feed it a scan or a typed value.
async function sendSheet(page) {
  await page.waitForFunction(() => {
    const seen = new Set();
    function walk(vnode) {
      if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return null;
      seen.add(vnode);
      if (vnode.component) {
        if (vnode.component.type?.name === 'SendModal') return vnode.component;
        const hit = walk(vnode.component.subTree);
        if (hit) return hit;
      }
      if (vnode.suspense) {
        const hit = walk(vnode.suspense.activeBranch);
        if (hit) return hit;
      }
      if (Array.isArray(vnode.children)) {
        for (const child of vnode.children) {
          const hit = walk(child);
          if (hit) return hit;
        }
      }
      return null;
    }
    const send = walk(window.__audit.app._instance.subTree);
    if (!send) return false;
    window.__sendModal = send.proxy;
    return true;
  }, null, { timeout: 30000 });
}

try {
  // ── Inside BuhoGO (a wallet is set up) ────────────────────────────────────
  const { context: inside, page } = await openContext({ withWallet: true });
  await page.goto(`${base}/#/p/${maria.npub}?save=1`, { timeout: 90000 });
  await page.waitForFunction(() => !!window.__audit?.app, null, { timeout: 90000 });
  await cardName(page, 'Maria');
  await asking(page, 'Save Maria to your contacts?');
  assert.deepEqual(await contactKeys(page), [], 'nothing is saved before the tap');
  await page.waitForFunction(() => !location.hash.includes('save='));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/save-question.png` });
  await page.locator('.pp-ask .pp-cta').click();
  await toast(page, 'Contact added');
  assert.deepEqual(await contactKeys(page), [maria.pubkey]);
  await askTitle(page).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  console.log('✓ a save link asks first, and saves the verified person only on the tap');

  await push(page, `/p/${maria.npub}?save=1`);
  await toast(page, 'Maria is already in your contacts');
  await notAsking(page);
  assert.deepEqual(await contactKeys(page), [maria.pubkey]);
  console.log('✓ a save link for someone already saved says so and asks nothing');

  await push(page, `/p/${bob.npub}`);
  await cardName(page, 'Bob');
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
  assert.equal(await page.locator('.pp-top-name', { hasText: 'Maria' }).count(), 0);
  await notAsking(page);
  console.log('✓ another card link while a card is open shows the new person; a plain link asks nothing');

  await push(page, `/p/carol@example.com?k=${carol.npub}&save=1`);
  await cardName(page, 'Carol');
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
  await page.waitForTimeout(1500);
  await notAsking(page);
  assert.deepEqual(await contactKeys(page), [maria.pubkey]);
  console.log('✓ a save link whose path is a name only offers the Save button, even when the name checks out');

  await push(page, `/p/${viewer.npub}?save=1`);
  await page.getByText('This is you', { exact: true }).waitFor();
  await page.getByText('You have not set up payments yet.', { exact: true }).waitFor();
  assert.equal(await page.locator('button.pp-save').count(), 0);
  await page.waitForTimeout(1000);
  await notAsking(page);
  assert.deepEqual(await contactKeys(page), [maria.pubkey]);
  await page.screenshot({ path: `${output}/own-card.png` });
  console.log('✓ your own card says "This is you" and never asks');

  await setLocked(page, true);
  await push(page, `/p/${dave.npub}?save=1`);
  await cardName(page, 'Dave');
  await page.waitForTimeout(1500);
  await notAsking(page);
  await setLocked(page, false);
  await asking(page, 'Save Dave to your contacts?');
  await page.locator('.pp-ask-later').click();
  await askTitle(page).waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);
  assert.deepEqual(await contactKeys(page), [maria.pubkey]);
  assert.equal(await hash(page), `#/p/${dave.npub}`);
  console.log('✓ under the app lock the question waits for the unlock, and Not now saves nobody');

  // A slow card overtaken by another link must never write over the newer one.
  await push(page, `/p/${frank.npub}?save=1`);
  await push(page, `/p/${grace.npub}`);
  await cardName(page, 'Grace');
  await page.waitForTimeout(3000);
  assert.equal((await page.locator('.pp-top-name').innerText()).trim(), 'Grace');
  await notAsking(page);
  await page.locator('.pp-micro').click();
  await page.getByText('grace@example.com', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  console.log('✓ a slow card overtaken by another link never replaces the person on screen');

  // Leaving while a card still loads: it must not act on its save link later.
  await page.evaluate(async (h) => {
    await window.__audit.app.config.globalProperties.$pinia._s.get('addressBook')
      .addNostrContact({ pubkey: h.pubkey, npub: h.npub, event: h.event, allowWithoutLightningAddress: true });
  }, henry);
  const errorsBefore = errors.length;
  await push(page, `/p/${henry.npub}?save=1`);
  await push(page, '/about');
  await page.waitForTimeout(3500);
  assert.equal(await page.getByText('Henry is already in your contacts', { exact: true }).count(), 0);
  assert.deepEqual(errors.slice(errorsBefore), [], 'the left page must stay silent, not fail');
  console.log('✓ a card left while loading never speaks up afterwards');

  // Send: a scanned or a pasted card link opens the card, ready to pay.
  await push(page, '/wallet');
  await page.waitForFunction(() => location.hash.startsWith('#/wallet'));
  await sendSheet(page);
  await page.evaluate((value) => window.__sendModal.onQRDetect(value), saveLink(erin));
  await cardName(page, 'Erin');
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
  await page.waitForTimeout(1000);
  await notAsking(page);
  assert.ok(!(await contactKeys(page)).includes(erin.pubkey));
  assert.equal(await hash(page), `#/p/${erin.npub}`);
  console.log('✓ Send\'s scanner opens a scanned card code on the card, and asks nothing');

  await push(page, '/wallet');
  await page.waitForFunction(() => location.hash.startsWith('#/wallet'));
  await sendSheet(page);
  // An ATM-style web link whose path happens to start with /p/ but carries
  // the payment in lightning= is a payment, never a card.
  const lnurl = bech32.encode('lnurl', bech32.toWords(Buffer.from('https://atm.example/withdraw?k1=abc')), 1023).toUpperCase();
  const atmType = await page.evaluate((value) => {
    window.__sendModal.show = true;
    window.__sendModal.manualInput = value;
    const type = window.__sendModal.detectedInputType;
    window.__sendModal.manualInput = '';
    return type;
  }, `https://atm.example/p/7?lightning=${lnurl}`);
  assert.equal(atmType, 'lnurl');
  await page.evaluate((value) => { window.__sendModal.manualInput = value; }, saveLink(ivy));
  await page.locator('.detected-pill', { hasText: 'Public profile' }).waitFor({ timeout: 10000 });
  await cardName(page, 'Ivy');
  await notAsking(page);
  assert.equal(await hash(page), `#/p/${ivy.npub}`);
  console.log('✓ a card link pasted into Send opens the card like a scan; a /p/ payment link stays a payment');
  await inside.close();

  // ── A stranger's browser (no wallet, no identity) ─────────────────────────
  const android = await openContext({
    withWallet: false,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  });
  await android.page.goto(`${base}/#/p/${maria.npub}?save=1`, { timeout: 90000 });
  await cardName(android.page, 'Maria');
  const intentHref = await android.page.locator('a.pp-save').getAttribute('href');
  assert.equal(
    intentHref,
    `intent://go.mybuho.de/p/${maria.npub}?save=1#Intent;scheme=https;package=mybuho.buhogo;S.browser_fallback_url=${encodeURIComponent(HOME)};end`,
  );
  await android.page.waitForTimeout(1000);
  await notAsking(android.page);
  assert.deepEqual(await contactKeys(android.page), []);
  await android.page.screenshot({ path: `${output}/web-android.png` });
  console.log('✓ on Android the web Save hands the save link to BuhoGO, with the download page as fallback');
  await android.context.close();

  const iphone = await openContext({
    withWallet: false,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await iphone.page.goto(`${base}/#/p/${maria.npub}`, { timeout: 90000 });
  await cardName(iphone.page, 'Maria');
  assert.equal(await iphone.page.locator('a.pp-save').getAttribute('href'), HOME);
  console.log('✓ elsewhere the web Save goes to the download page');
  await iphone.context.close();

  const unexpected = errors.filter((message) => !/reading 'send'/.test(message));
  assert.deepEqual(unexpected, [], `page errors: ${unexpected.join(' | ')}`);
  console.log(`\nAll card save checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
