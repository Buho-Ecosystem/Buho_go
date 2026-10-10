/**
 * Spark multi-wallet in the real UI: Home chip and switcher (with the total),
 * adding a wallet from Settings, the six-wallet limit, the guarded removal
 * with "Move funds", changing the address of a wallet that is not active,
 * and the onboarding tour. Store logic is covered by the unit specs; here
 * the store's network-facing actions are scripted so the screens can be
 * driven end to end without keys, a Spark connection or real money.
 *
 * Start `npm run dev -- --port 9013` (or set SPARK_WALLETS_BASE_URL), then
 * run `node scripts/check-spark-wallets.mjs`. Screenshots land in
 * output/spark-multi-wallet/.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.SPARK_WALLETS_BASE_URL || 'http://localhost:9013';
const output = 'output/spark-multi-wallet';
await mkdir(output, { recursive: true });

const spark = (id, name, accountNumber, cachedBalance = 0) => ({
  id, type: 'spark', name, createdAt: 1000 + accountNumber,
  connectionData: { accountNumber, network: 'MAINNET', encryptedMnemonic: 'audit' },
  metadata: { sparkAddress: `spark1${id}`, hasBackedUp: true, cachedBalance, lud16: `${id}@btc.mybuho.de` },
});
const three = [spark('main', 'Main', 1, 25000), spark('savings', 'Savings', 2, 500000), spark('shop', 'Shop', 3, 0)];
const six = [...three, spark('family', 'Family', 4), spark('travel', 'Travel', 5), spark('gifts', 'Gifts', 0)];

const browser = await chromium.launch({ headless: true });
const errors = [];

async function open(wallets, { active = wallets[0].id, dark = false, locale = 'en-US', width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('[Vue warn]')) errors.push(message.text().slice(0, 300));
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(({ wallets, active, dark, locale }) => {
    window.__AUDIT__ = { theme: dark ? 'dark' : 'light', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', locale);
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets, activeWalletId: active, hasBackedUp: true, sparkModelVersion: 2 }));
  }, { wallets, active, dark, locale });
  return page;
}

/** Script the store's network-facing actions in the running app. */
async function scriptStore(page) {
  await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    await store.whenHydrated();
    const live = (id) => {
      store.connectionStates[id] = { connected: true };
      store.providers[id] = { isConnected: true, getLightningAddress: async () => null, checkLightningAddressAvailable: async () => true };
    };
    store.wallets.forEach((w) => live(w.id));
    store.connectSparkWallet = async (id) => live(id);
    window.addCalls = [];
    store.addSparkWallet = async ({ name }) => {
      window.addCalls.push(name);
      if (name.trim().toLowerCase() === 'main') throw Object.assign(new Error('taken'), { code: 'WALLET_NAME_TAKEN', problem: 'taken' });
      const used = new Set(store.sparkWallets.map((w) => w.connectionData.accountNumber));
      const accountNumber = [1, 2, 3, 4, 5, 0].find((n) => !used.has(n));
      const wallet = { id: `added-${accountNumber}`, type: 'spark', name: name.trim(), createdAt: Date.now(), connectionData: { accountNumber, network: 'MAINNET', encryptedMnemonic: 'audit' }, metadata: { hasBackedUp: true } };
      store.wallets.push(wallet);
      live(wallet.id);
      store.activeWalletId = wallet.id;
      return wallet;
    };
  });
}

const shot = (page, name) => page.screenshot({ path: `${output}/${name}.png` });
const toast = (page, text) => page.getByText(text, { exact: true }).first().waitFor();

try {
  // ---- Home: chip and switcher -------------------------------------------
  let page = await open(three, { active: 'savings' });
  await page.goto(`${base}/#/wallet`);
  const chip = page.locator('[data-audit="wallet-switcher"]');
  await chip.waitFor();
  assert.match(await chip.textContent(), /Savings/);
  assert.equal(await chip.locator('svg').count() >= 1, true, 'the chip carries the Spark mark');
  assert.equal(await page.locator('.spark-tabs').count(), 0, 'no Business/Personal tab bar');
  await scriptStore(page);
  await chip.click();
  const sheet = page.locator('.wallet-switcher-card');
  await sheet.waitFor();
  await page.waitForTimeout(400);
  assert.equal(await sheet.locator('.wallet-switch-card').count(), 3);
  assert.match(await sheet.locator('.switcher-total').textContent(), /525,000/);
  assert.equal(await sheet.locator('[aria-current="true"]').getAttribute('data-wallet-id'), 'savings');
  await shot(page, 'p4-switcher-light');
  await sheet.locator('[data-wallet-id="shop"]').click();
  await page.waitForFunction(() => document.querySelector('[data-audit="wallet-switcher"]')?.textContent.includes('Shop'));
  console.log('PASS: Home chip with the Spark mark, switcher with total and rows, switching by row');

  // ---- Settings: add a wallet --------------------------------------------
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  await scriptStore(page);
  await page.locator('.settings-page').getByText('Manage Wallets', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Wallet' }).click();
  const addRow = page.locator('[data-audit="add-spark-wallet"]');
  await addRow.waitFor();
  assert.match(await addRow.textContent(), /3 of 6 left/);
  await addRow.click();
  const addSheet = page.locator('.add-spark-card');
  await addSheet.waitFor();
  const nameField = addSheet.getByLabel('Wallet Name', { exact: true });
  assert.equal(await nameField.inputValue(), 'Wallet', 'a free default name is suggested');
  await nameField.fill('main');
  await addSheet.getByRole('button', { name: 'Create wallet' }).click();
  await addSheet.getByRole('alert').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await addSheet.getByRole('alert').textContent(), 'Another wallet already has this name.');
  await shot(page, 'p4-add-error');
  await nameField.fill('  Rainy day ');
  await addSheet.getByRole('button', { name: 'Create wallet' }).click();
  await toast(page, 'Switched to Rainy day');
  await addSheet.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.wallets-dialog-card [data-wallet-id="added-4"]').count(), 1, 'the new wallet is listed');
  console.log('PASS: Add Spark wallet from Settings with slots left, suggested name, inline name error, switch toast');

  // ---- Detail: address of a wallet that is not active ---------------------
  await page.locator('.wallets-dialog-card [data-wallet-id="savings"]').click();
  const panel = page.locator('.wallet-detail-panel');
  await panel.getByText('savings@btc.mybuho.de', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Change address' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.q-dialog')].some((d) => /Lightning address/i.test(d.textContent || '')));
  await page.keyboard.press('Escape');
  console.log('PASS: Spark detail shows its own address; Change address opens for that wallet');

  // ---- Removal: a funded wallet is emptied first ---------------------------
  page = await open(three);
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  await scriptStore(page);
  await page.locator('.settings-page').getByText('Manage Wallets', { exact: true }).click();
  await page.locator('.wallets-dialog-card [data-wallet-id="savings"]').click();
  await page.locator('.wallet-detail-panel').getByRole('button', { name: 'Remove Wallet' }).click();
  const blocked = page.locator('.q-dialog').filter({ hasText: 'Move the money first' });
  await blocked.waitFor();
  assert.match(await blocked.textContent(), /Savings still holds/);
  await page.waitForTimeout(400);
  await shot(page, 'p4-remove-blocked');
  await blocked.getByRole('button', { name: 'Move funds' }).click();
  await page.locator('.q-dialog').filter({ hasText: 'Transfer' }).last().waitFor();
  assert.equal(await page.evaluate(async () => (await import('/src/stores/wallet.js')).useWalletStore().wallets.length), 3, 'nothing was removed');
  console.log('PASS: removing a funded Spark wallet explains why and offers Move funds');

  // ---- Limit: the seventh is not offered ----------------------------------
  page = await open(six, { dark: true });
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  await page.locator('.settings-page').getByText('Manage Wallets', { exact: true }).click();
  await page.getByRole('button', { name: 'Add Wallet' }).click();
  await page.getByText('Add New Wallet', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-audit="add-spark-wallet"]').count(), 0, 'no add row at six Spark wallets');
  await shot(page, 'p4-add-dialog-at-limit-dark');
  console.log('PASS: at six Spark wallets the add row is not offered');

  // ---- German, dark, 320px: switcher and add sheet --------------------------
  page = await open(three, { dark: true, locale: 'de', width: 320, height: 640 });
  await page.goto(`${base}/#/wallet`);
  await page.locator('[data-audit="wallet-switcher"]').waitFor();
  await scriptStore(page);
  await page.locator('[data-audit="wallet-switcher"]').click();
  await page.locator('.wallet-switcher-card').waitFor();
  await page.waitForTimeout(400);
  const overflow = await page.locator('.wallet-switcher-card').evaluate((n) => n.scrollWidth - n.clientWidth);
  assert.ok(overflow <= 0, 'no horizontal overflow at 320px');
  await shot(page, 'p4-switcher-de-dark-320');
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  await scriptStore(page);
  await page.locator('.settings-page').getByText('Wallets verwalten', { exact: true }).click();
  await page.getByRole('button', { name: 'Wallet hinzufügen' }).click();
  await page.locator('[data-audit="add-spark-wallet"]').click();
  await page.locator('.add-spark-card').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'p4-add-sheet-de-dark-320');
  console.log('PASS: German, dark and 320px for the switcher and the add sheet');

  // ---- Tour: no pair slides -------------------------------------------------
  page = await open(three);
  await page.goto(`${base}/#/spark-success`);
  await page.getByText('Your Spark wallet', { exact: true }).waitFor();
  assert.equal(await page.getByText('Your Business Wallet').count(), 0);
  console.log('PASS: the tour introduces one Spark wallet and up to six, no Business/Personal');

  const unexpected = errors.filter((e) => !/Failed to fetch|ERR_FAILED|fiat rates/i.test(e));
  assert.deepEqual(unexpected, [], 'no page errors or Vue warnings');
} finally {
  await browser.close();
}
