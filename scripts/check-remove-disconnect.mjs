/** Browser check for taking wallets off this phone (utils/walletRemoval.js):
 * Manage Wallets grouped by kind, the details of each kind, the Danger Zone,
 * every alert, and what is left afterwards. BuhoGO never deletes a wallet:
 * Spark and Arkade are "removed from this phone", NWC and LNbits are
 * "disconnected". Start `pnpm dev --port 9031` first (or set REMOVE_BASE_URL).
 * Screenshots go to output/remove-disconnect-check/. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.REMOVE_BASE_URL || 'http://localhost:9031';
const output = process.env.REMOVE_OUTPUT || new URL('../output/remove-disconnect-check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const NWC = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&secret=${'5e'.repeat(32)}`;
const WALLETS = [
  { id: 'main', type: 'spark', name: 'Main', metadata: {} },
  { id: 'savings', type: 'spark', name: 'Savings', metadata: {} },
  { id: 'ark', type: 'arkade', name: 'Arkade', metadata: {} },
  { id: 'hub', type: 'nwc', name: 'Alby Hub', nwcUrl: NWC, metadata: { methods: ['pay_invoice', 'make_invoice', 'get_balance'] } },
  { id: 'kitty', type: 'lnbits', name: 'Kitty', metadata: {} },
];
const BALANCES = { main: 184250, savings: 0, ark: 12000, hub: 48210, kitty: 2100 };

const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let n = 0;
const shot = async (page, name) => { n++; await page.screenshot({ path: `${output}/${String(n).padStart(2, '0')}-${name}.png` }); };

async function open({ theme = 'light', wallets = WALLETS, kiosk = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript((theme) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
  }, theme);
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 90000 });
  await page.evaluate(({ wallets, balances, kiosk }) => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true, isInitialized: true });
    store.wallets = wallets.map((w, i) => ({ ...w, createdAt: i + 1, lastUsed: i + 1 }));
    store.activeWalletId = wallets[0].id;
    store.hasBackedUp = true; // the Spark phrase; Arkade's own is not backed up
    for (const w of wallets) {
      store.connectionStates[w.id] = { connected: true, error: null };
      store.balanceStates[w.id] = { value: balances[w.id], known: true, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    }
    // Balances read moments ago count as fresh; no network in this check.
    store.refreshBalance = async () => {};
    if (kiosk) store.kioskWalletId = kiosk;
  }, { wallets, balances: BALANCES, kiosk });
  await pause(800);
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/settings'));
  await page.waitForTimeout(1400);
  const vm = await page.evaluateHandle(() => {
    for (const el of document.querySelectorAll('*')) for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'SettingsPage') return c.proxy;
  });
  return { page, context, errors, vm };
}

const dialogText = (page) => page.evaluate(() => [...document.querySelectorAll('.q-dialog .q-card')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).pop() || '');
const closeDialogs = async (page) => { await page.keyboard.press('Escape'); await pause(500); };
const store = (page, fn) => page.evaluate(fn);

// 1 · Manage Wallets and details, light and dark.
for (const theme of ['light', 'dark']) {
  const { page, context, errors, vm } = await open({ theme });
  await vm.evaluate((vm) => { vm.showWalletsDialog = true; });
  await page.waitForSelector('.wallets-group-title');
  await pause(600);
  // Members per group; within a group the list keeps its usual order (active first).
  const groups = await page.$$eval('.wallets-group-section', (sections) => sections.map((s) => [s.querySelector('.wallets-group-title').textContent.trim(), [...s.querySelectorAll('.wallet-row-name')].map((r) => r.textContent.trim()).sort()]));
  assert.deepEqual(groups, [['On this phone', ['Arkade', 'Main', 'Savings']], ['Connected', ['Alby Hub', 'Kitty']]]);
  await shot(page, `${theme}-manage-wallets`);
  if (theme === 'light') {
    for (const [id, name] of [['savings', 'spark'], ['ark', 'arkade'], ['hub', 'nwc']]) {
      await vm.evaluate((vm, id) => { vm.detailWalletId = id; }, id);
      await pause(600);
      const text = await page.$eval('.wallet-detail-panel', (el) => el.innerText);
      assert.equal(/delete/i.test(text), false, `${name}: no "delete"`);
      assert.equal(await page.locator('.detail-danger svg').count(), 0, `${name}: no trash icon`);
      if (id === 'hub') {
        assert.match(text, /Disconnect/);
        assert.match(text, /To revoke it, remove the connection in Alby Hub too\./);
        await page.locator('.detail-danger').scrollIntoViewIfNeeded();
      } else {
        assert.match(text, /Remove from this phone/);
        assert.match(text, id === 'savings' ? /Backed up/ : /Back up/);
      }
      await shot(page, `details-${name}`);
    }
  }
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ Manage Wallets: "On this phone" and "Connected"; details say Remove from this phone or Disconnect, never delete');

// 2 · The Danger Zone and its alerts.
{
  const { page, context, errors, vm } = await open({ kiosk: 'hub' });
  const header = page.getByText('Danger Zone', { exact: true });
  await header.scrollIntoViewIfNeeded();
  await header.click();
  await pause(700);
  const rows = await page.$$eval('.settings-row--destructive', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(rows, ['Remove Spark from this phone Main and Savings', 'Remove Arkade from this phone Back up first', 'Disconnect all connected wallets Alby Hub and Kitty']);
  await page.evaluate(() => window.scrollBy(0, 300));
  await pause(300);
  await shot(page, 'danger-zone');

  await page.getByText('Disconnect all connected wallets').click();
  await pause(600);
  assert.equal(await dialogText(page), 'Disconnect 2 wallets? Your money stays in Alby Hub and Kitty. The kiosk stops taking payments. Cancel Disconnect');
  await shot(page, 'alert-disconnect-all');
  await closeDialogs(page);

  await page.getByText('Remove Arkade from this phone').click();
  await pause(600);
  assert.match(await dialogText(page), /^Back up Arkade first It holds (₿ ?12,000|12,000 sats)\. Not now Back up now$/, 'the amount in the person\'s format');
  await shot(page, 'alert-back-up-first');
  await closeDialogs(page);

  await page.getByText('Remove Spark from this phone').click();
  await pause(600);
  assert.match(await dialogText(page), /^Remove Spark from this phone\? Its recovery phrase leaves too\./);
  assert.equal(await page.locator('.typed-removal-input').count(), 1, 'typed: the phrase leaves this phone');
  await shot(page, 'alert-typed');
  await closeDialogs(page);

  await vm.evaluate((vm) => vm.confirmRemoveWallet('hub'));
  await pause(600);
  assert.equal(await dialogText(page), 'Disconnect Alby Hub? Your money stays in Alby Hub. The kiosk stops taking payments. Cancel Disconnect');
  await shot(page, 'alert-disconnect-one');
  await closeDialogs(page);

  await vm.evaluate((vm) => vm.confirmRemoveWallet('savings'));
  await pause(600);
  assert.equal(await dialogText(page), 'Remove Savings from this phone? Your recovery phrase brings it back. Cancel Remove');
  await shot(page, 'alert-remove-one');
  await closeDialogs(page);

  // Disconnect all, for real: the kiosk binding and the default go with them.
  await page.getByText('Disconnect all connected wallets').click();
  await pause(500);
  await page.locator('.q-dialog .q-btn', { hasText: 'Disconnect' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('2 wallets disconnected'), null, { timeout: 5000 });
  await pause(400);
  await shot(page, 'after-disconnect-all');
  const left = await store(page, () => {
    const s = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    return { ids: s.wallets.map((w) => w.id), kiosk: s.kioskWalletId };
  });
  assert.deepEqual(left, { ids: ['main', 'savings', 'ark'], kiosk: null });
  assert.equal(await page.getByText('Disconnect all connected wallets').count(), 0, 'nothing left to disconnect');
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ Danger Zone: rows say what they cover, a blocked row says why, alerts are short, typed only when a phrase leaves');
console.log('✓ disconnecting all leaves no kiosk binding to a wallet that is gone');

// 3 · "Back up now" opens that wallet's recovery phrase in Security.
{
  const { page, context, errors, vm } = await open();
  await vm.evaluate((vm) => vm.openPhraseBackup('ark'));
  await page.waitForFunction(() => location.hash.startsWith('#/security'), null, { timeout: 10000 });
  await page.waitForSelector('.recovery-card', { state: 'visible', timeout: 10000 });
  await pause(1500);
  assert.equal(await page.locator('.recovery-card').count(), 1, 'the sheet stays open after the link is cleared');
  await pause(800);
  assert.equal(new URL(page.url()).hash, '#/security', 'the link is used once, then cleared');
  await shot(page, 'security-backup-opened');
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ "Back up now" opens Security on that wallet\'s recovery phrase');

await browser.close();
console.log(`Screenshots: ${output}`);
