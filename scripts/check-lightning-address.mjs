/**
 * Real Quasar UI with scripted address-server responses. No wallet secrets,
 * external payments, or upstream calls. Uses the real store mutation actions.
 * Start VITE_BREEZ_API_KEY=test-fixture-key npm run dev -- --port 9019,
 * then node scripts/check-lightning-address.mjs. All LNURL requests are intercepted.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.ADDRESS_AUDIT_BASE_URL || 'http://localhost:9019';
const baseline = process.env.ADDRESS_AUDIT_BASELINE === '1';
const output = process.env.ADDRESS_AUDIT_OUTPUT || 'output/lightning-address';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const wallets = ['main', 'savings'].map((id, index) => ({
  id, name: index ? 'Savings' : 'Everyday', type: 'spark', createdAt: index + 1000,
  connectionData: { accountNumber: index + 1, network: 'MAINNET', encryptedMnemonic: 'audit' },
  metadata: { sparkAddress: `spark1${id}`, lud16: `${id}@btc.mybuho.de`, hasBackedUp: true },
}));

async function open({ dark = false, locale = 'en-US', width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'warning' && msg.text().includes('[Vue warn]')) errors.push(msg.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**', socket => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(({ wallets, dark, locale }) => {
    window.__AUDIT__ = { theme: dark ? 'dark' : 'light', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', locale);
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets, activeWalletId: 'main', hasBackedUp: true, sparkModelVersion: 2 }));
  }, { wallets, dark, locale });
  await page.goto(`${base}/#/settings`);
  await page.locator('.settings-page').waitFor();
  await page.evaluate(async () => {
    const store = (await import('/src/stores/wallet.js')).useWalletStore();
    await store.whenHydrated();
    const server = { addresses: { main: 'main', savings: 'savings' }, registrations: [], offline: false, loseReply: false, failCheck: false, limited: false };
    window.addressAudit = server;
    const info = id => server.addresses[id] ? { lightningAddress: `${server.addresses[id]}@btc.mybuho.de`, username: server.addresses[id] } : null;
    for (const wallet of store.wallets) {
      store.connectionStates[wallet.id] = { connected: true };
      store.providers[wallet.id] = {
        isConnected: true, getLightningAddress: async () => info(wallet.id), identityPubkey: () => wallet.id,
        checkLightningAddressAvailable: async () => { if (server.failCheck) throw new Error('offline'); return true; },
        registerLightningAddress: async username => {
          server.registrations.push(username);
          if (server.limited) throw new Error('Network error (status 429)');
          server.addresses[wallet.id] = username;
          if (server.loseReply) { server.offline = true; throw new Error('response lost'); }
          return info(wallet.id);
        },
        authorizeLightningAddressTransfer: async to => ({ username: server.addresses[wallet.id], pubkey: to }),
        claimLightningAddressTransfer: async authorization => {
          delete server.addresses.main;
          server.addresses[wallet.id] = authorization.username;
          if (server.loseReply) { server.offline = true; throw new Error('response lost'); }
          return info(wallet.id);
        },
      };
    }
    store.connectSparkWallet = async () => {};
    store._readSparkLightningAddress = async (id, { transfereePubkey } = {}) => {
      if (server.offline) throw new Error('offline');
      const address = info(id);
      return address && transfereePubkey ? { ...address, transferAuthorization: { username: address.username, pubkey: transfereePubkey } } : address;
    };
  });
  const manage = { 'en-US': 'Manage Wallets', de: 'Wallets verwalten', es: 'Gestionar Carteras' }[locale];
  await page.locator('.settings-page').getByText(manage, { exact: true }).click();
  await page.locator('.wallets-dialog-card [data-wallet-id="main"]').click();
  return { page, context };
}
async function addressSheet(page, { empty = false } = {}) {
  await page.locator('.wallet-detail-panel .detail-group').filter({ hasText: 'main@btc.mybuho.de' }).locator('.detail-group-action').first().click();
  const sheet = page.locator('.lnaddr-sheet');
  await sheet.locator(empty ? '.lnaddr-input' : '.lnaddr-address').waitFor();
  return sheet;
}
async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function review(sheet) {
  await sheet.locator('.lnaddr-cta-secondary').click();
  await sheet.locator('.lnaddr-input').fill('everyday');
  await sheet.locator('button[type="submit"]').waitFor({ state: 'visible' });
  await sheet.page().waitForFunction(() => !document.querySelector('.lnaddr-sheet button[type="submit"]')?.disabled);
  await sheet.locator('.lnaddr-input').press('Enter');
  await sheet.locator('.lnaddr-consequence').waitFor();
}

try {
  for (const dark of [false, true]) {
    const { page, context } = await open({ dark });
    const sheet = await addressSheet(page);
    if (baseline) {
      await sheet.locator('.lnaddr-cta-secondary').click();
      await sheet.locator('.lnaddr-input').fill('everyday');
      await shot(page, `before-${dark ? 'dark' : 'light'}`);
      await context.close();
      continue;
    }
    await review(sheet);
    assert.match(await sheet.locator('.lnaddr-consequence').textContent(), /main@btc.mybuho.de will stop receiving payments/);
    assert.equal(await page.evaluate(() => window.addressAudit.registrations.length), 0, 'review does not mutate');
    await shot(page, `review-${dark ? 'dark' : 'light'}`);
    await sheet.getByRole('button', { name: 'Change address', exact: true }).click();
    await sheet.getByText('everyday@btc.mybuho.de', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.addressAudit.registrations), ['everyday']);
    await shot(page, `success-${dark ? 'dark' : 'light'}`);
    await context.close();
  }
  if (!baseline) {
    const { page, context } = await open();
    const sheet = await addressSheet(page);
    await review(sheet);
    await page.evaluate(() => { window.addressAudit.loseReply = true; });
    await sheet.getByRole('button', { name: 'Change address', exact: true }).click();
    await sheet.getByRole('alert').waitFor();
    assert.equal(await sheet.getByRole('button', { name: 'Copy address', exact: true }).count(), 0);
    assert.match(await sheet.getByRole('alert').textContent(), /could not be confirmed/);
    assert.equal(await page.evaluate(async () => (await import('/src/stores/wallet.js')).useWalletStore().activeWalletLightningAddress), null);
    await shot(page, 'unconfirmed-light');
    await page.evaluate(() => { window.addressAudit.offline = false; });
    await sheet.getByRole('button', { name: 'Check address', exact: true }).click();
    await sheet.getByText('everyday@btc.mybuho.de', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.addressAudit.registrations.length), 1, 'recovery reads without another registration');
    await context.close();

    // A sheet kept open must not keep sharing a snapshot that another
    // device changed, or that the store has marked as unverified.
    const changed = await open();
    const changedSheet = await addressSheet(changed.page);
    await changed.page.evaluate(async () => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async value => { window.copiedAddress = value; },
      } });
      const store = (await import('/src/stores/wallet.js')).useWalletStore();
      window.addressAudit.addresses.main = 'elsewhere';
      // A stale/null event is only a signal to check; the server owns the truth.
      await store.noteSparkLightningAddress('main', null);
    });
    await changedSheet.getByRole('alert').waitFor();
    assert.equal(await changedSheet.getByRole('button', { name: 'Copy address', exact: true }).count(), 0);
    assert.equal(await changed.page.evaluate(() => window.addressAudit.registrations.length), 0, 'a stale null event cannot rename an existing server assignment');
    await changedSheet.getByRole('button', { name: 'Check address', exact: true }).click();
    await changedSheet.getByText('elsewhere@btc.mybuho.de', { exact: true }).waitFor();
    await changedSheet.getByRole('button', { name: 'Copy address', exact: true }).click();
    assert.equal(await changed.page.evaluate(() => window.copiedAddress), 'elsewhere@btc.mybuho.de');
    await changed.page.evaluate(async () => {
      const store = (await import('/src/stores/wallet.js')).useWalletStore();
      await store._markSparkAddressPending(['main']);
    });
    await changedSheet.getByRole('alert').waitFor();
    assert.equal(await changedSheet.getByRole('button', { name: 'Copy address', exact: true }).count(), 0);
    await changedSheet.getByRole('button', { name: 'Check address', exact: true }).click();
    await changedSheet.getByText('elsewhere@btc.mybuho.de', { exact: true }).waitFor();
    await changed.page.evaluate(async () => {
      const store = (await import('/src/stores/wallet.js')).useWalletStore();
      store.wallets = store.wallets.filter(wallet => wallet.id !== 'main');
    });
    await changedSheet.getByRole('alert').waitFor();
    assert.equal(await changedSheet.getByRole('button', { name: 'Copy address', exact: true }).count(), 0, 'removing a wallet invalidates the open sheet');
    await changed.context.close();

    // Confirmed absence is different from an unavailable lookup: the first
    // claim must remain usable without letting a stale SDK cache resurface.
    const firstClaim = await open();
    await firstClaim.page.evaluate(() => { delete window.addressAudit.addresses.main; });
    const firstSheet = await addressSheet(firstClaim.page, { empty: true });
    await firstSheet.locator('.lnaddr-input').fill('firstaddress');
    await firstSheet.getByText('Available', { exact: true }).waitFor();
    await firstSheet.locator('.lnaddr-input').press('Enter');
    await firstSheet.getByRole('button', { name: 'Claim address', exact: true }).click();
    await firstSheet.getByText('firstaddress@btc.mybuho.de', { exact: true }).waitFor();
    assert.deepEqual(await firstClaim.page.evaluate(() => window.addressAudit.registrations), ['firstaddress']);
    await firstClaim.context.close();

    // Availability errors remain beside the field, with a retry action.
    const retry = await open();
    const retrySheet = await addressSheet(retry.page);
    await retrySheet.locator('.lnaddr-cta-secondary').click();
    await retry.page.evaluate(() => { window.addressAudit.failCheck = true; });
    await retrySheet.locator('.lnaddr-input').fill('newname');
    await retrySheet.getByRole('button', { name: 'Check availability', exact: true }).waitFor();
    await retry.page.evaluate(() => { window.addressAudit.failCheck = false; });
    await retrySheet.getByRole('button', { name: 'Check availability', exact: true }).click();
    await retrySheet.getByText('Available', { exact: true }).waitFor();
    await retry.context.close();

    const limited = await open();
    const limitedSheet = await addressSheet(limited.page);
    await review(limitedSheet);
    await limited.page.evaluate(() => { window.addressAudit.limited = true; });
    await limitedSheet.getByRole('button', { name: 'Change address', exact: true }).click();
    await limitedSheet.getByRole('alert').waitFor();
    assert.match(await limitedSheet.getByRole('alert').textContent(), /Too many address changes/);
    await limited.context.close();

    const moving = await open();
    await moving.page.locator('.wallet-detail-panel').getByRole('button', { name: 'Move to another wallet', exact: true }).click();
    const move = moving.page.locator('.move-card');
    await move.getByRole('button', { name: 'Move address', exact: true }).waitFor();
    await moving.page.evaluate(() => { window.addressAudit.loseReply = true; });
    await move.getByRole('button', { name: 'Move address', exact: true }).click();
    await move.getByRole('alert').waitFor();
    assert.match(await move.getByRole('alert').textContent(), /could not be confirmed/);
    await shot(moving.page, 'move-unconfirmed-light');
    await moving.page.evaluate(() => { window.addressAudit.offline = false; });
    await move.getByRole('button', { name: 'Check addresses', exact: true }).click();
    await move.getByText('main@btc.mybuho.de', { exact: true }).waitFor();
    assert.equal(await move.getByRole('alert').count(), 0);
    assert.equal(await move.getByRole('button', { name: 'Move address', exact: true }).isDisabled(), true, 'a source without an address cannot transfer again');
    await moving.context.close();

    for (const locale of ['de', 'es']) {
      const narrow = await open({ dark: true, locale, width: 320, height: 640 });
      const narrowSheet = await addressSheet(narrow.page);
      await review(narrowSheet);
      const overflow = await narrowSheet.evaluate(node => node.scrollWidth - node.clientWidth);
      assert.ok(overflow <= 0, `${locale}: no horizontal overflow at 320px`);
      await shot(narrow.page, `review-${locale}-dark-320`);
      await narrow.context.close();
    }

    // Exercise the actual pinned WASM SDK against an isolated LNURL fixture.
    // This verifies the cache behavior that makes a disposable lookup necessary.
    const probe = await open();
    let recoveries = 0;
    await probe.page.route('**/lnurlpay/*/recover', route => {
      recoveries += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        lnurl: 'https://lnurl-audit.example/.well-known/lnurlp/fixture',
        lightning_address: `${recoveries === 1 ? 'first' : 'second'}@${new URL(route.request().url()).hostname}`,
        username: recoveries === 1 ? 'first' : 'second', description: 'Address test fixture',
      }) });
    });
    const actualSdk = await probe.page.evaluate(async () => {
      const service = await import('/src/services/breezSdk.js');
      const mod = await service.ensureWasmInit();
      const ids = [];
      const instances = [];
      async function quietInstance() {
        const id = `address-fixture-${crypto.randomUUID()}`;
        ids.push(id);
        const config = mod.defaultServerConfig('regtest');
        config.apiKey = 'test-fixture-key';
        config.lnurlDomain = 'lnurl-audit.example';
        config.backgroundTasksEnabled = false;
        config.realTimeSyncServerUrl = undefined;
        config.maxDepositClaimFee = { type: 'fixed', amount: 0 };
        let builder = mod.SdkBuilder.new(config, {
          type: 'mnemonic', mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        });
        builder = builder.withAccountNumber(1);
        builder = await builder.withDefaultStorage(`breez-${id}`);
        const sdk = await builder.build();
        instances.push(sdk);
        return sdk;
      }
      try {
        const first = await quietInstance();
        const initial = await first.getLightningAddress();
        const cached = await first.getLightningAddress();
        const fresh = await service.lookupLightningAddress('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', {
          accountNumber: 1, network: 'REGTEST', transfereePubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        });
        return { initial: initial.username, cached: cached.username, fresh: fresh.username, authorized: fresh.transferAuthorization.username };
      } finally {
        for (const sdk of instances) await sdk.disconnect();
        for (const id of ids) await service.deleteWalletStorage(id);
      }
    });
    assert.deepEqual(actualSdk, { initial: 'first', cached: 'first', fresh: 'second', authorized: 'second' });
    assert.equal(recoveries, 2, 'a fresh SDK reads the address server; a cached SDK does not');
    await probe.context.close();
  }
  assert.deepEqual(errors, [], 'no page errors or Vue warnings');
  console.log(`PASS: ${baseline ? 'baseline captures' : 'review, confirmation, response-loss recovery, stale-event and open-sheet invalidation, availability retry, light/dark, DE/ES at 320px, real SDK cache behavior'}`);
} finally { await browser.close(); }
