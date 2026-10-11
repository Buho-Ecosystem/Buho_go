/**
 * Browser checks for using an identity from another app.
 * Start `npx quasar dev --port 9014` first (or set OWN_IDENTITY_BASE_URL).
 *
 * Uses the public BIP-39 test phrase and throwaway keys only. Relays are a
 * local fake (every subscription ends empty, every event is accepted), so
 * nothing leaves the machine. A mock browser extension stands in for NIP-07.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { generateSecretKey, getPublicKey, nip19, finalizeEvent } from 'nostr-core';

const base = process.env.OWN_IDENTITY_BASE_URL || 'http://127.0.0.1:9014';
const output = process.env.OWN_IDENTITY_OUTPUT || 'output/own-identity';
await mkdir(output, { recursive: true });
const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const IMPORTED = generateSecretKey();
const EXTENSION = generateSecretKey();

const browser = await chromium.launch({ headless: true });
const errors = [];

async function openApp(theme, { extension = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) return route.continue();
    return route.abort();
  });
  const port = new URL(base).port;
  await page.routeWebSocket((url) => !url.port || url.port !== port, (ws) => {
    ws.onMessage((raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      setTimeout(() => {
        if (message[0] === 'REQ') ws.send(JSON.stringify(['EOSE', message[1]]));
        if (message[0] === 'EVENT') ws.send(JSON.stringify(['OK', message[1]?.id, true, '']));
      }, 200);
    });
  });
  if (extension) {
    // A browser extension holding EXTENSION's key: signs in the page.
    await page.exposeFunction('__extensionSign', (template) => finalizeEvent(template, EXTENSION));
    await page.addInitScript((pubkey) => {
      window.nostr = {
        getPublicKey: async () => pubkey,
        signEvent: async (template) => window.__extensionSign(template),
      };
    }, getPublicKey(EXTENSION));
  }
  await page.addInitScript((theme) => {
    window.__AUDIT__ = { theme };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  }, theme);
  await page.goto(`${base}/#/about`, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__audit?.app, null, { timeout: 120000 });
  await page.evaluate(async (phrase) => {
    const pinia = window.__audit.app.config.globalProperties.$pinia;
    const { useIdentityStore } = await import('/src/stores/identity.js');
    const identity = useIdentityStore(pinia);
    await identity.importMnemonic(phrase);
    const rows = await identity.listNostrIdentities();
    localStorage.setItem(`buhoGO_profile_v1_${rows[0].pubkeyHex}`, JSON.stringify({ version: 1, displayName: 'Gundula Gause' }));
  }, TEST_PHRASE);
  await goto(page, '/identity/identities');
  await page.locator('.acct-row').first().waitFor();
  return page;
}

async function goto(page, path) {
  await page.evaluate((p) => window.__audit.app.config.globalProperties.$router.push(p), path);
  await page.waitForTimeout(600);
}

const active = (page) => page.evaluate(async () => {
  const { useIdentityStore } = await import('/src/stores/identity.js');
  return useIdentityStore(window.__audit.app.config.globalProperties.$pinia).activeExternalId;
});

async function openImport(page) {
  await page.getByRole('button', { name: 'Add identity' }).click();
  await page.getByRole('menuitem', { name: 'Use an existing identity' }).click();
  await page.getByText('Use an existing identity', { exact: true }).last().waitFor();
  await page.waitForTimeout(400);
}

try {
  // ---- Secret key ----------------------------------------------------------
  const page = await openApp('light');
  await page.getByRole('button', { name: 'Add identity' }).click();
  await page.getByRole('menuitem', { name: 'Create new identity' }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/add-choice.png` });
  await page.getByRole('menuitem', { name: 'Use an existing identity' }).click();
  await page.locator('.import-row').first().waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.getByText('Browser extension', { exact: true }).count(), 0, 'no extension, no extension row');
  await page.screenshot({ path: `${output}/choose-light.png` });

  await page.getByText('Secret key', { exact: true }).last().click();
  await page.locator('#import-secret').fill(nip19.npubEncode(getPublicKey(IMPORTED)));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('This is a public code. Paste the secret key instead.').waitFor();
  await page.locator('#import-secret').fill(nip19.nsecEncode(IMPORTED));
  assert.equal(await page.locator('#import-secret').getAttribute('type'), 'password', 'the key is never shown');
  await page.screenshot({ path: `${output}/secret-light.png` });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Is this you?').waitFor();
  await page.getByText('No profile found').waitFor();
  assert.equal(await page.evaluate(() => document.body.innerText.includes('nsec1')), false, 'the key is not on the page');
  await page.screenshot({ path: `${output}/confirm-light.png` });
  await page.getByRole('button', { name: 'Use this identity' }).click();
  await page.getByText('Now using Imported identity').waitFor({ timeout: 30000 });
  assert.ok(await active(page), 'the import is in use');
  await page.getByText('Secret key on this phone').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/list-imported-light.png`, fullPage: true });

  // Its own page while in use: keys, nothing to delete.
  await page.getByRole('button', { name: 'Details for Imported identity' }).click();
  await page.getByText('In use', { exact: true }).waitFor();
  await page.getByText('Secret key', { exact: true }).waitFor();
  assert.equal(await page.getByText('Delete from this phone').count(), 0);

  // Back to the identity made here, then delete the import behind an alert.
  await goto(page, '/identity/identities');
  await page.locator('.acct-main', { hasText: 'Gundula Gause' }).click();
  await page.getByText('Now using Gundula Gause').waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Details for Imported identity' }).click();
  await page.getByRole('button', { name: 'Delete from this phone' }).click();
  await page.getByText('Delete Imported identity from this phone?').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/delete-alert-light.png` });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForURL(/#\/identity\/identities$/);
  await page.waitForTimeout(400);
  assert.equal(await page.getByText('Secret key on this phone').count(), 0);

  // ---- Remote signer: a wrong link is explained ----------------------------
  await openImport(page);
  await page.getByText('Remote signer', { exact: true }).last().click();
  await page.locator('#import-bunker').fill('https://example.com');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('This is not a remote signer link. It starts with bunker://').waitFor();
  await page.screenshot({ path: `${output}/bunker-light.png` });

  // ---- Browser extension, dark --------------------------------------------
  const web = await openApp('dark', { extension: true });
  await openImport(web);
  await web.getByText('Browser extension', { exact: true }).waitFor();
  await web.screenshot({ path: `${output}/choose-dark.png` });
  await web.getByText('Browser extension', { exact: true }).click();
  await web.getByText('Is this you?').waitFor();
  await web.getByRole('button', { name: 'Use this identity' }).click();
  await web.getByText('Now using Imported identity').waitFor({ timeout: 30000 });
  await web.waitForTimeout(600);
  await web.getByRole('button', { name: 'Details for Imported identity' }).click();
  await web.getByText('Signer', { exact: true }).waitFor();
  assert.equal(await web.getByText('Secret key', { exact: true }).count(), 0, 'no secret key to copy');
  await web.waitForTimeout(400);
  await web.screenshot({ path: `${output}/detail-extension-dark.png`, fullPage: true });

  const relevant = errors.filter((message) => !/reading 'send'|WebSocket|Failed to fetch/i.test(message));
  assert.deepEqual(relevant, [], 'no page errors');
  console.log(`PASS: a secret key and a browser extension become identities after "Is this you?", switch with Undo, show their own detail; a public code or wrong link is explained; deleting asks first. Screenshots: ${output}`);
} finally {
  await browser.close();
}
