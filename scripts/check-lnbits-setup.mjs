/** Controlled browser check for the LNbits setup steps and the Settings
 * Lightning address sheet. Start `pnpm dev --port 9031` first (or set
 * LNBITS_BASE_URL). Every external request is blocked; the LNbits server is
 * a stub on the page's own provider, so each step renders as a user sees it. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.LNBITS_BASE_URL || 'http://localhost:9031';
const output = process.env.LNBITS_OUTPUT || new URL('../output/lnbits-setup', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const SERVER = 'https://legend.lnbits.com';
const WALLET = { id: 'lnbits-1', name: 'Shop till', type: 'lnbits', balance: 0, metadata: {}, connectionData: { serverUrl: SERVER, walletId: 'abc', adminKey: 'k'.repeat(32) } };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  const passthrough = ['fonts.googleapis.com', 'fonts.gstatic.com'];
  return url.origin === base || passthrough.includes(url.hostname) ? route.continue() : route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await page.addInitScript((wallet) => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buho-theme-mode', 'light');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({
    wallets: [wallet], activeWalletId: wallet.id, preferredFiatCurrency: 'EUR', hasBackedUp: true,
  }));
}, WALLET);

let n = 0;
async function shot(name) {
  await page.waitForTimeout(450);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}
const go = path => page.evaluate(p => window.__audit.app.config.globalProperties.$router.push(p), path);

/** The setup page's component, with a stub LNbits server behind its address steps. */
const setupStep = (step, { status = 'available', existing = [] } = {}) => page.evaluate(async ({ step, status, existing, server }) => {
  let c = document.querySelector('.iform-sheet').__vueParentComponent;
  while (c && c.type.name !== 'LNBitsSetupPage') c = c.parent;
  const vm = c.proxy;
  window.__lnbits = { status };
  vm.addressProvider = {
    lnurlpStatus: async () => window.__lnbits.status,
    listLightningAddresses: async () => existing,
    createLightningAddress: async ({ username }) => {
      if (username === 'taken') throw new Error('LNBits API error: username already exists');
      return { address: `${username}@legend.lnbits.com` };
    },
  };
  vm.validatedServerUrl = server;
  vm.validatedBalance = 12400;
  vm.walletName = 'Shop till';
  vm.address = { walletId: 'lnbits-1', domain: 'legend.lnbits.com', existing };
  // Each step mounts fresh, as in the real flow.
  vm.step = 'connect';
  await vm.$nextTick();
  vm.step = step;
}, { step, status, existing, server: SERVER });

/** Settings with a stub provider for the active LNbits wallet. */
const stubSettings = ({ status, existing = [] }) => page.evaluate(({ status, existing }) => {
  let c = document.querySelector('.settings-page, .q-page').__vueParentComponent;
  while (c && !c.proxy?._buildActiveLNBitsProvider) c = c.parent;
  const vm = c.proxy;
  window.__lnbits = { status };
  vm._buildActiveLNBitsProvider = () => ({
    lnurlpStatus: async () => window.__lnbits.status,
    listLightningAddresses: async () => existing,
    createLightningAddress: async ({ username }) => ({ address: `${username}@legend.lnbits.com` }),
  });
  vm.lnurlpStatus = {};
  vm.maybeProbeLnurlpForActiveWallet();
}, { status, existing });

try {
  await page.goto(`${base}/#/lnbits-setup`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.locator('.iform-sheet').waitFor({ timeout: 60000 });
  await shot('connect');

  // 1 · Wallet found: name and balance, no wallet ID.
  await setupStep('name');
  await page.getByText('Wallet found', { exact: true }).waitFor();
  await page.getByText('₿ 12,400', { exact: true }).waitFor();
  assert.equal(await page.getByText('Wallet ID').count(), 0, 'no wallet ID');
  await shot('wallet-found');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Add wallet', exact: true }).isDisabled(), true, 'no name, no wallet');
  await page.locator('#' + await page.locator('.wallet-found__input').getAttribute('id')).fill('Shop till');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByText('Connect LNbits', { exact: true }).waitFor();
  console.log('✓ wallet found: name and balance, Back returns to Connect');

  // 2 · Lightning address, create: the field is the preview.
  await setupStep('address');
  await page.getByText('Get paid by name, like email.', { exact: true }).waitFor();
  await page.getByText('@legend.lnbits.com', { exact: true }).waitFor();
  assert.equal(await page.locator('.ln-field__user').inputValue(), 'shoptill', 'suggested from the wallet name');
  await shot('address-create');
  await page.locator('.ln-field__user').fill('Shop Till');
  await page.getByText('Use lowercase letters, numbers, dots, hyphens or underscore.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Create address', exact: true }).isDisabled(), true);
  await page.locator('.ln-field__user').fill('taken');
  await page.getByRole('button', { name: 'Create address', exact: true }).click();
  await page.getByText('That name is already taken. Try another.').waitFor();
  await shot('address-taken');
  await page.locator('.ln-field__user').fill('shoptill');
  await page.getByRole('button', { name: /Thank-you message/ }).click();
  await page.locator('.ln-field__message').fill('Thanks for shopping with us');
  await shot('address-message');
  console.log('✓ address: suggestion, rules, taken name, optional message on tap');

  // 2 · Existing addresses: pick one, or a new one.
  await setupStep('address', { existing: [
    { id: '1', username: 'shop', address: 'shop@legend.lnbits.com' },
    { id: '2', username: 'tips', address: 'tips@legend.lnbits.com' },
  ] });
  await page.getByText('Pick one for this wallet.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('radio', { checked: true }).count(), 1);
  await shot('address-pick');
  await page.getByRole('button', { name: 'New address', exact: true }).click();
  await page.getByRole('button', { name: 'Use an existing address', exact: true }).waitFor();
  console.log('✓ pick: one list, a check per address, New address');

  // Pay Links is off: who runs the server, then an automatic re-check.
  await setupStep('paylinks', { status: 'off' });
  await page.getByText('Pay Links is off', { exact: true }).waitFor();
  await page.getByText('Who runs this server?', { exact: true }).waitFor();
  await shot('paylinks-off');
  await page.evaluate(() => { window.__lnbits.status = 'available'; });
  // "I do" opens the Extensions page (a new tab on the web) ...
  const asked = context.waitForEvent('request', request => request.url() === `${SERVER}/extensions`);
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: /^I do/ }).click();
  await asked;
  await (await opened).close();
  // ... and coming back asks the server again on its own.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Get paid by name, like email.', { exact: true }).waitFor();
  console.log('✓ Pay Links off: who runs it; back from Extensions, on to the address');

  // Dark
  await setupStep('address');
  await page.evaluate(() => window.__audit.setDark(true));
  await shot('address-create-dark');
  await setupStep('paylinks', { status: 'off' });
  await shot('paylinks-off-dark');
  await page.evaluate(() => window.__audit.setDark(false));
  console.log('✓ dark theme');

  // Settings: the row leads somewhere in every state.
  await go('/settings');
  await page.getByText('Lightning Address', { exact: true }).first().waitFor({ timeout: 30000 });
  await stubSettings({ status: 'off' });
  await page.getByText('Needs Pay Links', { exact: true }).waitFor();
  await page.getByText('Needs Pay Links', { exact: true }).scrollIntoViewIfNeeded();
  await shot('settings-needs-paylinks');
  await page.getByText('Needs Pay Links', { exact: true }).click();
  await page.getByText('Pay Links is off', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
  await shot('settings-paylinks-sheet');
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await page.waitForTimeout(500);

  await stubSettings({ status: 'available', existing: [{ id: '1', username: 'shop', address: 'shop@legend.lnbits.com' }] });
  await page.getByText('Get one to receive payments by name', { exact: true }).waitFor();
  await page.getByText('Get one to receive payments by name', { exact: true }).click();
  await page.getByText('Pick one for this wallet.', { exact: true }).waitFor();
  await shot('settings-address-sheet');
  await page.getByRole('button', { name: 'Use address', exact: true }).click();
  await page.getByText('shop@legend.lnbits.com').first().waitFor();
  console.log('✓ Settings: Needs Pay Links opens the help; Pay Links on opens the address sheet');

  // German at 320 px: the longest copy must fit.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${base}/#/lnbits-setup`);
  await page.reload();
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.locator('.iform-sheet').waitFor();
  await page.evaluate(async () => {
    const { applyLocale } = await import('/src/i18n/locales.js');
    applyLocale(window.__audit.app._instance.proxy.$i18n, 'de');
  });
  await setupStep('paylinks', { status: 'off' });
  await page.getByText('Pay Links ist aus', { exact: true }).waitFor();
  const overflow = await page.locator('.iform-sheet').evaluate(el => el.scrollWidth > el.clientWidth);
  assert.equal(overflow, false, 'no sideways overflow in German at 320 px');
  await shot('paylinks-off-de-320');
  console.log('✓ German at 320 px');

  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} catch (error) {
  console.log('page errors:', [...new Set(errors)]);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
