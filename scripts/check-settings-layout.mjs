// Settings and Security as grouped lists: the wallets with their logos and
// total, each wallet's own page, Display, Advanced, and the Security tab with
// the keyring at the top. Local and isolated: no real wallets or connections.
// Start `npx quasar dev --port 9120` (or set SETTINGS_LAYOUT_BASE_URL), then run this.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.SETTINGS_LAYOUT_BASE_URL || 'http://localhost:9120';
const output = 'output/settings-layout';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];

const WALLETS = [
  { id: 'main', type: 'spark', name: 'Main', connectionData: { accountNumber: 0, network: 'MAINNET', encryptedMnemonic: 'x' }, metadata: { cachedBalance: 412000, hasBackedUp: true, lud16: 'maria@btc.mybuho.de' } },
  { id: 'savings', type: 'spark', name: 'Savings', connectionData: { accountNumber: 1, network: 'MAINNET', encryptedMnemonic: 'x' }, metadata: { cachedBalance: 2150000, hasBackedUp: true } },
  { id: 'arkade', type: 'arkade', name: 'Arkade', connectionData: { encryptedMnemonic: 'x' }, metadata: { cachedBalance: 48000, arkadeAddress: 'ark1qq4hfssprtcgnjzf8qlw2f78yvjau5kldfugg29k34y7j96q2w4t567uy9ukgfl2ntulzvlzj7swsprfs4wrsag2jqkyfmcpksrcjgvrq8d3lt' } },
  { id: 'hub', type: 'nwc', name: 'Lightning at home', nwcUrl: 'nostr+walletconnect://example', metadata: { cachedBalance: 96500, alias: 'Home node' } },
  { id: 'shop', type: 'lnbits', name: 'Shop', connectionData: { serverUrl: 'https://pay.example.org', walletId: 'w', adminKey: 'k' }, metadata: { cachedBalance: 18250, lud16: 'shop@pay.example.org' } },
];

async function open(theme) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning' && message.text().includes('[Vue warn]')) errors.push(message.text().slice(0, 240));
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
    if (url.origin === base || url.hostname === 'api.iconify.design' || url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**', socket => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close();
  });
  await page.addInitScript(({ theme, wallets }) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets, activeWalletId: 'main', biometricsEnabled: false, sparkModelVersion: 2, preferredFiatCurrency: 'EUR', defaultDisplayCurrency: 'bitcoin' }));
  }, { theme, wallets: WALLETS });
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  // Every wallet answers except the NWC one, so the rows and the total show both states.
  await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    store.connectionStates = { main: { connected: true }, savings: { connected: true }, arkade: { connected: true }, hub: { connected: false }, shop: { connected: true } };
    store.connectWallet = async () => {};
    store.connectSparkWallet = async () => {};
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return { context, page };
}

const shot = (page, name) => page.screenshot({ path: `${output}/${name}.png` });
const sheet = page => page.locator('.q-dialog .q-card').last();

try {
  for (const theme of ['light', 'dark']) {
    const { context, page } = await open(theme);

    // 1 · Settings: the large title, the wallets with their logos, the total on top.
    assert.equal(await page.locator('.settings-large-title').textContent(), 'Settings');
    assert.equal(await page.locator('.hub-header-title').textContent().then(t => t.trim()), '', 'the bar stays empty while the large title shows');
    assert.equal(await page.locator('.settings-quick-toggles, .quick-toggles').count(), 0, 'no quick toggles above the groups');
    const rows = await page.locator('#settings-wallets [data-wallet-id]').evaluateAll(els => els.map(el => el.dataset.walletId));
    assert.equal(rows.length, WALLETS.length, 'one row per wallet');
    for (const type of ['spark', 'nwc', 'lnbits', 'arkade']) {
      assert.ok(await page.locator(`#settings-wallets .wallet-logo-tile--${type}`).count() >= 1, `${type} row wears its logo`);
    }
    const total = await page.locator('[data-audit="settings-wallets-total"]').innerText();
    assert.match(total, /Total/);
    assert.match(total, /5 wallets, 4 online/, 'the total says how many answer');
    assert.match(await page.locator('[data-wallet-id="main"]').innerText(), /Active/);
    // One test for online (the wallet page's): the row, the total and the page agree.
    assert.match(await page.locator('[data-wallet-id="hub"]').innerText(), /NWC · Offline/);
    assert.equal(await page.locator('[data-audit="settings-add-wallet"]').count(), 1);
    // App lock says what it falls back to.
    assert.match(await page.locator('.settings-content').innerText(), /phone's PIN, pattern or password/);
    await shot(page, `01-settings-${theme}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    // Hub headers scroll with the page, so the bar never takes the title: it stays empty.
    assert.equal(await page.locator('.hub-header-title').textContent().then(t => t.trim()), '', 'the bar keeps no title');
    await shot(page, `02-settings-lower-${theme}`);
    await page.evaluate(() => window.scrollTo(0, 0));

    // 2 · Each wallet's page: its logo, and what only that kind has.
    const pages = { main: 'detail-auto-add', arkade: 'detail-arkade-address', shop: 'detail-lnbits-address', hub: null };
    for (const [id, marker] of Object.entries(pages)) {
      await page.locator(`[data-wallet-id="${id}"]`).click();
      const panel = page.locator('.wallet-detail-panel');
      await panel.waitFor();
      await page.waitForTimeout(350);
      if (marker) assert.equal(await panel.locator(`[data-audit="${marker}"]`).count(), 1, `${id} page shows its own rows`);
      if (theme === 'light' || id === 'main') await shot(page, `03-wallet-${id}-${theme}`);
      await panel.getByRole('button', { name: 'Close', exact: true }).click();
      await panel.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.walletId), id, 'focus returns to the row');
    }

    // 3 · Display: theme, main unit, hidden balances, amount format.
    await page.locator('[data-audit="settings-display-row"]').click();
    await page.locator('[data-audit="settings-display-sheet"]').waitFor();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('[data-audit="settings-display-sheet"] [role="radio"][aria-checked="true"]').count(), 3, 'one check per pick-one group');
    await shot(page, `04-display-${theme}`);
    await page.locator('[data-audit="settings-display-sheet"]').getByRole('switch', { name: 'Hide balances' }).click().catch(async () => {
      await page.locator('[data-audit="settings-display-sheet"] .q-toggle').first().click();
    });
    assert.equal(await page.evaluate(async () => (await import('/src/stores/wallet.js')).useWalletStore().balanceHidden), true, 'Hide balances hides them');
    await page.locator('[data-audit="settings-display-sheet"] .q-toggle').first().click();
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await page.locator('[data-audit="settings-display-sheet"]').waitFor({ state: 'detached' });

    // 4 · Advanced: exchange rates, the business check, removing every wallet of a kind.
    await page.locator('[data-audit="settings-advanced-row"]').scrollIntoViewIfNeeded();
    await page.locator('[data-audit="settings-advanced-row"]').click();
    await page.locator('[data-audit="settings-advanced-sheet"]').waitFor();
    await page.waitForTimeout(350);
    const advanced = await page.locator('[data-audit="settings-advanced-sheet"]').innerText();
    for (const text of ['Exchange rates', 'Business check', 'Danger Zone']) assert.match(advanced, new RegExp(text, 'i'));
    await shot(page, `05-advanced-${theme}`);
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await page.locator('[data-audit="settings-advanced-sheet"]').waitFor({ state: 'detached' });

    // 5 · Security: no title, the keyring on top, then the backups.
    await page.evaluate(() => window.__go ? window.__go('/security') : (location.hash = '#/security'));
    await page.locator('.backup-choices').waitFor();
    // An identity whose words are checked, so all three kinds of backup show.
    await page.evaluate(() => {
      const identity = window.__audit.app.config.globalProperties.$pinia._s.get('identity');
      identity.bootstrapped = true;
      identity.backupConfirmed = true;
    });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.hub-header-title').textContent().then(t => t.trim()), '', 'Security has no title');
    assert.equal(await page.locator('.backup-hero .backup-keyring, .backup-hero img, .backup-hero svg').count() >= 1, true, 'the keyring opens the tab');
    const security = await page.locator('.backup-choices').innerText();
    assert.match(security, /Spark wallets/);
    assert.match(security, /Main and Savings/);
    assert.match(security, /Arkade/);
    assert.match(security, /Emergency exit kit/);
    assert.match(security, /Restore from backup/);
    assert.match(security, /Identity/);
    assert.match(await page.locator('[data-audit="backup-status"]').innerText(), /^Bitcoin not checked yet$/, 'the status uses the Home reminder\'s words');
    await shot(page, `06-security-${theme}`);

    // 6 · ?section=wallets (Home's Manage) lands on Settings with the wallets on top.
    await page.evaluate(() => { location.hash = '#/settings?section=wallets'; });
    await page.locator('#settings-wallets').waitFor();
    assert.equal(await page.locator('.wallet-detail-panel').count(), 0, 'no sheet opens on its own');

    // 7 · ?section=advanced opens Advanced once and leaves the address, so Back cannot reopen it.
    // The link arrives from another page (Settings mounts afresh), as it does from the docs.
    await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/security'));
    await page.locator('.backup-choices').waitFor();
    await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/settings?section=advanced'));
    await page.locator('[data-audit="settings-advanced-sheet"]').waitFor();
    assert.equal(await page.evaluate(() => location.hash.includes('section=')), false, 'the section leaves the address');
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await page.locator('[data-audit="settings-advanced-sheet"]').waitFor({ state: 'detached' });

    await context.close();
  }
  assert.deepEqual(errors, [], 'no page errors or Vue warnings');
  console.log(`✓ Settings and Security as grouped lists (light + dark); pictures in ${output}/`);
} finally {
  await browser.close();
}
