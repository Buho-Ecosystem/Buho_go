/** Controlled browser check for moving money into wallets (#392): the Social
 * Bucket's destination list and the internal-transfer pickers, with an NWC
 * connection that may only pay and one that may only receive. Start
 * `pnpm dev --port 9031` first (or set NWC_BASE_URL). Every external request
 * is blocked; wallets and the bucket are seeded into the stores, and each
 * sheet is rendered by the running app with its own Vue and context. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.NWC_BASE_URL || 'http://localhost:9031';
const output = process.env.NWC_OUTPUT || new URL('../output/nwc-receiving', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const url = (key) => `nostr+walletconnect://${key.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'5e'.repeat(32)}`;
const WALLETS = [
  { id: 'kitty', type: 'lnbits', name: 'Kitty', metadata: {}, balance: 52000 },
  { id: 'hub', type: 'nwc', name: 'Alby Hub', nwcUrl: url('a'), balance: 48210,
    metadata: { methods: ['pay_invoice', 'get_balance', 'get_info'] } },
  { id: 'coinos', type: 'nwc', name: 'Coinos', nwcUrl: url('c'), balance: 3100,
    metadata: { methods: ['make_invoice', 'get_balance', 'lookup_invoice', 'get_info'] } },
];

const browser = await chromium.launch({ headless: true });
let n = 0;

async function open({ language = 'en-US', theme = 'light', width = 390, wallets = WALLETS, active = 'hub' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname) ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', (socket) => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(({ language, theme }) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', language);
    localStorage.setItem('buho-theme-mode', theme);
  }, { language, theme });
  await page.goto(base);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 60000 });
  await page.evaluate(({ wallets, active }) => {
    const pinia = window.__audit.app.config.globalProperties.$pinia;
    const store = pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true });
    store.wallets = wallets.map(({ balance, ...w }) => ({ ...w, createdAt: 1, lastUsed: 1 }));
    store.activeWalletId = active;
    for (const w of wallets) {
      store.connectionStates[w.id] = { connected: true, error: null, nwcInstance: w.type === 'nwc' ? {} : null };
      store.balanceStates[w.id] = { value: w.balance, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    }
  }, { wallets, active });
  return { page, errors, context };
}

/**
 * Render one of the app's components on top, with the app's own Vue and
 * context. Sheets mount closed and then open, as in the app: what a sheet
 * prepares on opening (its default choice) runs as it would there.
 */
async function render(page, file, props) {
  await page.evaluate(async ({ file, props }) => {
    const vueUrl = performance.getEntriesByType('resource').map((e) => e.name).find((name) => /\/deps\/vue\.js/.test(name));
    const { h, render: draw } = await import(vueUrl);
    const component = (await import(file)).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mount = (extra) => {
      const vnode = h(component, { ...props, ...extra });
      vnode.appContext = window.__audit.app._context;
      draw(vnode, host);
    };
    mount({ modelValue: false });
    window.__checkOpen = () => mount({ modelValue: true });
  }, { file, props });
}

const openSheet = (page) => page.evaluate(() => window.__checkOpen());

async function shot(page, name) {
  await page.waitForTimeout(500);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}

const rowState = (page, selector) => page.$$eval(selector, (rows) => rows.map((row) => ({
  name: row.querySelector('strong, .wallet-name')?.textContent.trim(),
  disabled: row.disabled || row.classList.contains('disabled'),
  note: row.querySelector('small, .hint-text')?.textContent.trim() || '',
})));

const seedBucket = (page) => page.evaluate(() => {
  const bucket = window.__audit.app.config.globalProperties.$pinia._s.get('socialBucket');
  bucket.$patch({ heldProofs: [{ id: '00', amount: 2100, secret: 's', C: '02' }], heldPaymentCount: 3 });
});

// 1 · Social Bucket: the wallet in use (Alby Hub) may only pay, so the
// default is the first wallet that can receive; Alby Hub stays listed.
{
  const { page, errors, context } = await open();
  // The sheet creates the bucket store; its contents are seeded right after.
  await render(page, '/src/components/identity/SocialBucketSheet.vue', {});
  await seedBucket(page);
  await openSheet(page);
  await page.locator('.sb-destination').waitFor();
  assert.match(await page.locator('.sb-destination strong').textContent(), /Kitty/);
  await page.locator('.sb-destination').click();
  await page.locator('.sb-wallet-list').waitFor();
  const rows = await rowState(page, '.sb-wallet-option');
  assert.deepEqual(rows.map((r) => [r.name, r.disabled]), [['Kitty', false], ['Alby Hub', true], ['Coinos', false]]);
  assert.equal(rows[1].note, "Can't receive");
  await shot(page, 'bucket-destinations');
  await page.locator('.sb-wallet-option', { hasText: 'Alby Hub' }).click({ force: true });
  assert.match(await page.locator('.sb-destination strong').textContent(), /Kitty/, 'a wallet that cannot receive is not chosen');
  assert.equal(await page.locator('.btn-primary').isEnabled(), true);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ bucket: listed, dimmed with the reason, never chosen; default skips it');
}

// 2 · Nothing here can receive: the sheet says so and offers no move.
{
  const { page, errors, context } = await open({ wallets: [WALLETS[1]], active: 'hub' });
  // The sheet creates the bucket store; its contents are seeded right after.
  await render(page, '/src/components/identity/SocialBucketSheet.vue', {});
  await seedBucket(page);
  await openSheet(page);
  await page.locator('.sb-no-wallet-copy', { hasText: 'No wallet here can receive' }).waitFor();
  await page.getByText('Allow receiving in your wallet app, or add a wallet that can.').waitFor();
  assert.equal(await page.locator('.btn-primary').isDisabled(), true);
  await shot(page, 'bucket-none-can-receive');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ bucket: with no wallet able to receive, it says so');
}

// 3 · Internal transfer: Coinos may only receive (never a source), Alby Hub
// may only pay (never a destination).
{
  const { page, errors, context } = await open({ active: 'kitty' });
  await render(page, '/src/components/InternalTransferModal.vue', {});
  await openSheet(page);
  await page.locator('.wallet-btn').first().waitFor();
  await page.locator('.wallet-btn').first().click();
  await page.getByRole('heading', { name: 'Select Source Wallet' }).waitFor();
  const from = await rowState(page, '.picker-row');
  assert.deepEqual(from.find((r) => r.name === 'Coinos'), { name: 'Coinos', disabled: true, note: 'Receive only' });
  await shot(page, 'transfer-source');
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Select Source Wallet' }).waitFor({ state: 'hidden' });
  await page.locator('.wallet-btn').nth(1).click();
  await page.getByRole('heading', { name: 'Select Destination Wallet' }).waitFor();
  const to = await rowState(page, '.picker-row');
  assert.deepEqual(to.find((r) => r.name === 'Alby Hub'), { name: 'Alby Hub', disabled: true, note: "Can't receive" });
  assert.equal(to.find((r) => r.name === 'Coinos').disabled, false);
  await shot(page, 'transfer-destination');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ transfer: "Receive only" as a source, "Can\'t receive" as a destination');
}

// 3b · The wallet asked for is still connecting when the transfer opens:
// once it is connected it becomes the source, rather than nothing.
{
  const { page, errors, context } = await open({ active: 'kitty' });
  await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.connectionStates.kitty.connected = false;
    store.ensureWalletConnectedForTransfer = async (id) => {
      await new Promise((r) => setTimeout(r, 300));
      store.connectionStates[id].connected = true;
      return {};
    };
  });
  await render(page, '/src/components/InternalTransferModal.vue', {});
  await openSheet(page);
  await page.locator('.wallet-btn').first().filter({ hasText: 'Kitty' }).waitFor({ timeout: 10000 });
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ transfer: a source that was still connecting is chosen once it is');
}

// 3c · Kiosk wallet (#397): every wallet listed; one that cannot take kiosk
// payments is not choosable and says why. Peek may create invoices but
// neither look them up nor list payments, so a paid sale would never show.
{
  const peek = { id: 'peek', type: 'nwc', name: 'Peek', nwcUrl: url('e'), balance: 0, metadata: { methods: ['make_invoice', 'get_info'] } };
  const { page, errors, context } = await open({ wallets: [...WALLETS, peek], active: 'kitty' });
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/settings'));
  // Elements belong to the components that render them; climb to the page.
  const settingsPage = () => {
    for (const node of document.querySelectorAll('.q-page *')) {
      for (let c = node.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'SettingsPage') return c;
    }
    return null;
  };
  await page.waitForFunction(settingsPage, null, { timeout: 30000 });
  await page.evaluate((find) => {
    const c = new Function(`return (${find})`)()();
    c.proxy.kioskWalletSelection = 'kitty';
    c.proxy.kioskPinSetupStep = 'selectWallet';
    c.proxy.showKioskPinSetupDialog = true;
  }, settingsPage.toString());
  await page.locator('.kiosk-wallet-row').first().waitFor();
  const rows = await page.$$eval('.kiosk-wallet-row', (list) => list.map((row) => ({
    name: row.querySelector('.kiosk-wallet-row-name')?.textContent.trim(),
    disabled: row.disabled,
    note: row.querySelector('.kiosk-wallet-row-type')?.textContent.trim(),
  })));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.Kitty.disabled, false);
  assert.equal(byName.Coinos.disabled, false, 'receive-only with lookup: a fine kiosk wallet');
  assert.deepEqual([byName['Alby Hub'].disabled, byName['Alby Hub'].note], [true, "Can't receive"]);
  assert.deepEqual([byName.Peek.disabled, byName.Peek.note], [true, "Can't confirm payments"]);
  await shot(page, 'kiosk-wallets');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ kiosk: wallets that cannot take kiosk payments are listed with the reason, not choosable');
}

// 4 · Dark, and German at 320 px.
{
  const { page, errors, context } = await open({ theme: 'dark' });
  // The sheet creates the bucket store; its contents are seeded right after.
  await render(page, '/src/components/identity/SocialBucketSheet.vue', {});
  await seedBucket(page);
  await openSheet(page);
  await page.locator('.sb-destination').click();
  await page.locator('.sb-wallet-list').waitFor();
  await shot(page, 'bucket-destinations-dark');
  assert.deepEqual(errors, []);
  await context.close();
}
{
  const { page, errors, context } = await open({ language: 'de', width: 320 });
  // The sheet creates the bucket store; its contents are seeded right after.
  await render(page, '/src/components/identity/SocialBucketSheet.vue', {});
  await seedBucket(page);
  await openSheet(page);
  await page.locator('.sb-destination').click();
  await page.getByText('Kann nicht empfangen').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'no sideways scroll at 320 px');
  await shot(page, 'bucket-destinations-de-320');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ dark theme, and German at 320 px');
}

await browser.close();
console.log(`Screenshots: ${output}`);
