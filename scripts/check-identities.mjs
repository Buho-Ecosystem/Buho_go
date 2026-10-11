/**
 * Browser checks for the Identities list and identity detail pages.
 * Start `npx quasar dev --port 9014` first (or set IDENTITIES_BASE_URL).
 *
 * Uses the public BIP-39 test phrase only; all external traffic is blocked,
 * so relay publishes fail and the store keeps its pointer flagged dirty.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.IDENTITIES_BASE_URL || 'http://127.0.0.1:9014';
const output = process.env.IDENTITIES_OUTPUT || 'output/identities-hig';
await mkdir(output, { recursive: true });
const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const NAMES = ['Gundula Gause', 'Market stall', 'Book club'];
const RELAY_DELAY_MS = 400;

const browser = await chromium.launch({ headless: true });
const errors = [];

async function openApp(theme, language = 'en-US') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) return route.continue();
    return route.abort();
  });
  // A fake relay: every subscription ends empty and every event is accepted,
  // a little late so the switching window can be seen. The dev server's own
  // socket stays real, or the app cannot navigate.
  const port = new URL(base).port;
  await page.routeWebSocket((url) => !url.port || url.port !== port, (ws) => {
    ws.onMessage((raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      setTimeout(() => {
        if (message[0] === 'REQ') ws.send(JSON.stringify(['EOSE', message[1]]));
        if (message[0] === 'EVENT') ws.send(JSON.stringify(['OK', message[1]?.id, true, '']));
      }, RELAY_DELAY_MS);
    });
  });
  await page.addInitScript(({ theme, language }) => {
    window.__AUDIT__ = { theme };
    localStorage.setItem('buhoGO_language', language);
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  }, { theme, language });
  await page.goto(`${base}/#/about`, { timeout: 120000 });
  await page.waitForFunction(() => !!window.__audit?.app, null, { timeout: 120000 });
  return { context, page };
}

/** Three identities from the test phrase, named via their saved profiles; account 0 in use. */
async function seed(page) {
  return page.evaluate(async ({ phrase, names }) => {
    const pinia = window.__audit.app.config.globalProperties.$pinia;
    const { useIdentityStore } = await import('/src/stores/identity.js');
    const identity = useIdentityStore(pinia);
    const pointer = {
      relays: ['wss://stub.invalid'],
      fetcher: async () => null,
      publisher: () => ({ firstAccept: Promise.resolve(null), allSettled: Promise.resolve([]) }),
    };
    await identity.importMnemonic(phrase);
    await identity.createAnotherNostrIdentity({ pointer });
    await identity.createAnotherNostrIdentity({ pointer });
    await identity.switchNostrIdentity(0, { pointer });
    const rows = await identity.listNostrIdentities();
    rows.forEach((row, i) => {
      localStorage.setItem(`buhoGO_profile_v1_${row.pubkeyHex}`, JSON.stringify({ version: 1, displayName: names[i] }));
    });
    return rows.map((r) => r.account);
  }, { phrase: TEST_PHRASE, names: NAMES });
}

async function goto(page, path) {
  await page.evaluate((path) => window.__audit.app.config.globalProperties.$router.push(path), path);
  await page.waitForTimeout(600);
}

const rowNames = (page) => page.locator('.acct-name').allTextContents();

try {
  const { page } = await openApp('light');
  assert.deepEqual(await seed(page), [0, 1, 2]);

  // The list: one row per identity, the one in use checked, add and erase present.
  await goto(page, '/identity/identities');
  await page.locator('.acct-row').nth(2).waitFor();
  assert.equal(await page.locator('.acct-row').count(), 3);
  assert.equal(await page.getByRole('img', { name: 'In use' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Details for Market stall' }).count(), 1);
  await page.getByRole('button', { name: 'Add identity' }).waitFor();
  await page.getByRole('button', { name: 'Erase all identities' }).waitFor();
  assert.equal(await page.getByText('Private key').count(), 0, 'the banned term is gone');
  await page.screenshot({ path: `${output}/list-light.png`, fullPage: true });

  // Tap a row: it becomes the identity in use, with Undo in the toast.
  await page.locator('.acct-main', { hasText: 'Market stall' }).click();
  // The switch shows its own window until it lands.
  await page.getByText('Switching to Market stall').waitFor({ timeout: 10000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/switching-light.png` });
  await page.getByText('Now using Market stall').waitFor({ timeout: 30000 });
  await page.locator('.switching-card').waitFor({ state: 'detached', timeout: 3000 });
  await page.screenshot({ path: `${output}/switched-light.png` });
  const activeAfterSwitch = await page.evaluate(async () => {
    const { useIdentityStore } = await import('/src/stores/identity.js');
    return useIdentityStore(window.__audit.app.config.globalProperties.$pinia).nostrAccountIndex;
  });
  assert.equal(activeAfterSwitch, 1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByText('Now using Gundula Gause').waitFor({ timeout: 30000 });

  // Detail of another identity: use, keys, remove.
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Details for Book club' }).click();
  await page.getByRole('button', { name: 'Use this identity' }).waitFor();
  await page.getByText('Public code', { exact: true }).waitFor();
  await page.getByText('Secret key', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/detail-light.png`, fullPage: true });

  await page.getByRole('button', { name: 'Remove from this phone' }).click();
  await page.getByText('Remove Book club from this phone?').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/remove-confirm-light.png` });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForURL(/#\/identity\/identities$/);
  await page.locator('.acct-row').nth(1).waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual(await rowNames(page), ['Gundula Gause', 'Market stall']);

  // A removed identity has no page.
  await goto(page, '/identity/identities/2');
  await page.waitForURL(/#\/identity\/identities$/);

  // The identity in use cannot be removed and offers no switch.
  await page.getByRole('button', { name: 'Details for Gundula Gause' }).click();
  await page.getByText('In use', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Remove from this phone' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Use this identity' }).count(), 0);
  await page.screenshot({ path: `${output}/detail-active-light.png`, fullPage: true });

  // The secret key sheet speaks of a secret key.
  await page.getByText('Secret key', { exact: true }).click();
  await page.getByRole('button', { name: 'Copy secret key' }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/secret-key-light.png` });

  // Dark mode and German at 320px.
  const dark = await openApp('dark');
  await seed(dark.page);
  await goto(dark.page, '/identity/identities');
  await dark.page.locator('.acct-row').nth(2).waitFor();
  await dark.page.waitForTimeout(500);
  await dark.page.screenshot({ path: `${output}/list-dark.png`, fullPage: true });
  await dark.page.getByRole('button', { name: 'Details for Market stall' }).click();
  await dark.page.getByRole('button', { name: 'Use this identity' }).waitFor();
  await dark.page.waitForTimeout(800);
  await dark.page.screenshot({ path: `${output}/detail-dark.png`, fullPage: true });

  const narrow = await openApp('light', 'de');
  await narrow.page.setViewportSize({ width: 320, height: 720 });
  await seed(narrow.page);
  await goto(narrow.page, '/identity/identities');
  await narrow.page.locator('.acct-row').nth(2).waitFor();
  await narrow.page.waitForTimeout(500);
  const overflow = await narrow.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'no horizontal scroll at 320px');
  await narrow.page.screenshot({ path: `${output}/list-de-320.png`, fullPage: true });

  const relevant = errors.filter((message) => !/reading 'send'|WebSocket|Failed to fetch/i.test(message));
  assert.deepEqual(relevant, [], 'no page errors');
  console.log(`PASS: identities list switches on tap with Undo, the detail page uses, shows keys and removes; the identity in use is protected; dark and 320px German render. Screenshots: ${output}`);
} finally {
  await browser.close();
}
