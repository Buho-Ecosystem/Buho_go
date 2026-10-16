/** Controlled browser check for connecting a wallet over Nostr Wallet Connect
 * and for the NWC details in Settings. Start `pnpm dev --port 9031` first (or
 * set NWC_BASE_URL). Every external request is blocked; the wallet behind the
 * connection is a stand-in on the page's own connection test, so each step
 * renders as a person sees it. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.NWC_BASE_URL || 'http://localhost:9031';
const output = process.env.NWC_OUTPUT || new URL('../output/nwc-connect', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const PK = 'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4';
const SECRET = '71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c';
const CONNECTION = `nostr+walletconnect://${PK}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&relay=wss%3A%2F%2Frelay.backup.example&secret=${SECRET}&lud16=shop%40getalby.com`;
const NORMALIZED = `nostr+walletconnect://${PK}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&relay=wss%3A%2F%2Frelay.backup.example&secret=${SECRET}&lud16=shop%40getalby.com`;
/** A different connection: each stand-in wallet has its own key and string. */
const connectionFor = (pubkey) => `nostr+walletconnect://${pubkey}?relay=wss%3A%2F%2Frelay.coinos.io&secret=${SECRET}`;

/** What the stand-in wallet answers, per scenario. */
const PROBES = {
  full: {
    normalized: NORMALIZED, connectionPubkey: PK, relays: ['wss://relay.getalby.com/v1', 'wss://relay.backup.example'],
    alias: 'Alby Hub', nodePubkey: '02aa11', network: 'mainnet',
    methods: ['pay_invoice', 'make_invoice', 'get_balance', 'list_transactions', 'lookup_invoice', 'get_info', 'get_budget'],
    notifications: ['payment_received'], lud16: 'shop@getalby.com', balanceSats: 48210,
    limit: { totalSats: 100000, usedSats: 12400, remainingSats: 87600, renewsAt: Date.UTC(2026, 10, 1), period: 'monthly' },
  },
  receiveOnly: {
    normalized: connectionFor('c'.repeat(64)), connectionPubkey: 'c'.repeat(64), relays: ['wss://relay.coinos.io'],
    alias: 'Coinos', nodePubkey: '02bb22', network: 'mainnet',
    methods: ['make_invoice', 'lookup_invoice', 'list_transactions', 'get_info'],
    notifications: [], lud16: null, balanceSats: null, limit: null,
  },
};

// Another receive-only connection, for the German step (the first one is added by then).
PROBES.receiveOnlyOther = { ...PROBES.receiveOnly, normalized: connectionFor('d'.repeat(64)), connectionPubkey: 'd'.repeat(64), nodePubkey: '02cc33' };

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
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buho-theme-mode', 'light');
});

let n = 0;
async function shot(name) {
  await page.waitForTimeout(450);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}
const go = path => page.evaluate(p => window.__audit.app.config.globalProperties.$router.push(p), path);

/** The setup page with a stand-in wallet behind its connection test. */
const standIn = (behaviour) => page.evaluate(({ behaviour, probes }) => {
  let c = document.querySelector('.iform-sheet').__vueParentComponent;
  while (c && c.type.name !== 'NWCSetupPage') c = c.parent;
  const vm = c.proxy;
  vm.probeConnection = async (url, { onWaiting } = {}) => {
    if (behaviour.waitFirst) {
      onWaiting?.();
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (behaviour.fail) throw Object.assign(new Error(behaviour.fail.message), { code: behaviour.fail.code });
    return structuredClone(probes[behaviour.probe]);
  };
  vm.step = 'connect';
}, { behaviour, probes: PROBES });

const field = () => page.locator('.nwc-connect__input');
const continueButton = () => page.getByRole('button', { name: /^Continue/ });

try {
  await page.goto(`${base}/#/nwc-setup`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.locator('.iform-sheet').waitFor({ timeout: 60000 });
  await page.getByText('Connect a wallet', { exact: true }).waitFor();
  assert.equal(await continueButton().isDisabled(), true, 'nothing to test yet');
  await shot('connect-empty');

  // 1 · The secret stays hidden; Show reveals it on request.
  await field().fill(CONNECTION);
  assert.equal(await field().getAttribute('type'), 'password');
  await shot('connect-pasted');
  await page.getByRole('button', { name: 'Show connection' }).click();
  assert.equal(await field().getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Hide connection' }).click();
  await field().fill('bunker://abc');
  await continueButton().click();
  await page.getByText(/NIP-46 signer/).waitFor();
  await shot('connect-invalid');
  console.log('✓ connect: hidden secret with reveal, Paste and Scan, plain reasons for a bad string');

  // 2 · Test first, name second: the wallet names itself.
  await standIn({ probe: 'full', waitFirst: true });
  await field().fill(CONNECTION);
  await continueButton().click();
  await page.getByText('Waiting for your wallet…').waitFor();
  await shot('connect-waiting');
  await page.getByText('Connected through relay.getalby.com').waitFor();
  assert.equal(await page.locator('.nwc-found__input').inputValue(), 'Alby Hub');
  await page.getByText('₿ 48,210', { exact: true }).waitFor();
  await page.getByText('shop@getalby.com', { exact: true }).waitFor();
  await page.getByText('₿ 87,600 left', { exact: true }).waitFor();
  assert.equal(await page.locator('.nwc-caps__item.is-off').count(), 0, 'every grant on');
  await shot('found');
  console.log('✓ found: name from the wallet, balance, address, grants, spending limit');

  // 3 · A limited connection is added, with what is missing said.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await standIn({ probe: 'receiveOnly' });
  await continueButton().click();
  await page.getByText('Sending is off for this connection.', { exact: false }).waitFor();
  await page.getByText('Not shared', { exact: true }).waitFor();
  assert.equal(await page.locator('.nwc-caps__item.is-off').count(), 2, 'Send and Balance struck through');
  await shot('found-receive-only');
  console.log('✓ a receive-only connection: added anyway, the gap said');

  // 4 · Which part did not answer.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await standIn({ fail: { code: 'NWC_NO_ANSWER', message: 'reply timeout' } });
  await continueButton().click();
  await page.getByText('No answer from the wallet', { exact: true }).waitFor();
  await shot('problem-no-answer');
  await page.getByRole('button', { name: 'Edit connection', exact: true }).click();
  await standIn({ fail: { code: 'NWC_RELAY_UNREACHABLE', message: 'Failed to connect' } });
  await continueButton().click();
  await page.getByText('Relay not reachable', { exact: true }).waitFor();
  await shot('problem-relay');
  await page.getByRole('button', { name: 'Edit connection', exact: true }).click();
  await standIn({ fail: { code: 'QUOTA_EXCEEDED', message: 'quota' } });
  await continueButton().click();
  await page.getByText(/used up its spending limit/).waitFor();
  console.log('✓ problems: no answer, relay, and the wallet\'s own refusals in words');

  // 5 · Add it, then the same wallet again.
  await standIn({ probe: 'full' });
  await continueButton().click();
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  await page.waitForFunction(() => location.hash.includes('/wallet'), null, { timeout: 30000 });
  const saved = await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    return JSON.parse(JSON.stringify(store.wallets.find((w) => w.type === 'nwc')));
  });
  assert.equal(saved.name, 'Alby Hub');
  assert.equal(saved.metadata.alias, 'Alby Hub', 'the alias is stored, no more "Unknown"');
  assert.deepEqual(saved.metadata.methods.includes('pay_invoice'), true);
  assert.match(saved.nwcUrl, /relay=.*relay=/, 'every relay kept');
  await go('/nwc-setup');
  await page.locator('.iform-sheet').waitFor();
  await standIn({ probe: 'full' });
  await field().fill(CONNECTION);
  await continueButton().click();
  await page.getByText('Already added', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add anyway' }).count(), 0, 'the very same connection cannot be added twice');
  await shot('duplicate');
  console.log('✓ added with its own name; the same connection again is caught');

  // 6 · Settings: the same facts, and whether the wallet answers.
  await go('/settings');
  await page.getByText('Manage Wallets', { exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    let c = document.querySelector('.q-page').__vueParentComponent;
    while (c && !('detailWalletId' in (c.proxy?.$data || {}))) c = c.parent;
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    const wallet = store.wallets.find((w) => w.type === 'nwc');
    store.nwcStatus[wallet.id] = 'answering';
    store.nwcLimits[wallet.id] = { totalSats: 100000, usedSats: 12400, remainingSats: 87600, renewsAt: Date.UTC(2026, 10, 1) };
    c.proxy.showWalletsDialog = true;
    c.proxy.detailWalletId = wallet.id;
  });
  await page.getByText('Answering', { exact: true }).waitFor();
  await page.getByText('This connection can', { exact: true }).first().waitFor();
  await shot('settings-details');
  console.log('✓ Settings: address, limit, grants, answering');

  // Dark
  await page.evaluate(() => window.__audit.setDark(true));
  await shot('settings-details-dark');
  await page.evaluate(() => window.__audit.setDark(false));

  // 7 · Home with a receive-only connection: a calm dash, no endless placeholder,
  // and it is never offered to pay.
  await go('/nwc-setup');
  await page.locator('.iform-sheet').waitFor();
  await standIn({ probe: 'receiveOnly' });
  await field().fill(CONNECTION);
  await continueButton().click();
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  await page.waitForFunction(() => location.hash.includes('/wallet'), null, { timeout: 30000 });
  await page.getByLabel('This connection does not share the balance').waitFor();
  await shot('home-receive-only');
  console.log('✓ Home: a connection without balance access shows a dash');

  // German at 320 px: the longest copy must fit.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${base}/#/nwc-setup`);
  await page.reload();
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.locator('.iform-sheet').waitFor();
  await page.evaluate(async () => {
    const { applyLocale } = await import('/src/i18n/locales.js');
    applyLocale(window.__audit.app._instance.proxy.$i18n, 'de');
  });
  await standIn({ probe: 'receiveOnlyOther' });
  await field().fill(CONNECTION);
  await page.getByRole('button', { name: /^Weiter/ }).click();
  await page.getByText(/Senden ist für diese Verbindung aus/).waitFor();
  const overflow = await page.locator('.iform-sheet').evaluate(el => el.scrollWidth > el.clientWidth);
  assert.equal(overflow, false, 'no sideways overflow in German at 320 px');
  await shot('found-de-320');
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
