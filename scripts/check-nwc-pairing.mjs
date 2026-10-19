/** Controlled browser check for choosing a wallet to connect and pairing
 * without a secret: Alby Hub (approve, then return), Coinos (approve, then
 * BuhoGO asks), a code a wallet app scans, the BuhoHub note, a return no one
 * waits for, and the entries in Welcome and Settings. Start
 * `pnpm dev --port 9033` first (or set PAIRING_BASE_URL). Every external
 * request is blocked; the wallet, its answer and its connection test are
 * stand-ins on the page, so each step renders as a person sees it. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.PAIRING_BASE_URL || 'http://localhost:9033';
const output = process.env.PAIRING_OUTPUT || new URL('../output/nwc-pairing', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const HUB_WALLET = 'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

/** What the stand-in wallet answers to the connection test. */
const probeFor = (alias, connection, extra = {}) => ({
  normalized: connection, connectionPubkey: connection.slice(22, 86), relays: ['wss://relay.getalby.com'],
  alias, nodePubkey: `02${alias.length}`, network: 'mainnet',
  methods: ['pay_invoice', 'make_invoice', 'get_balance', 'list_transactions', 'lookup_invoice', 'get_info', 'get_budget'],
  notifications: ['payment_received'], lud16: 'maria@getalby.com', balanceSats: 48210,
  limit: { totalSats: 100000, usedSats: 12400, remainingSats: 87600, renewsAt: Date.UTC(2026, 10, 1), period: 'monthly' },
  ...extra,
});

const browser = await chromium.launch({ headless: true });
let n = 0;

async function newPage({ dark = false, userAgent } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const passthrough = ['fonts.googleapis.com', 'fonts.gstatic.com'];
    return url.origin === base || passthrough.includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', (socket) => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript((theme) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buho-theme-mode', theme);
  }, dark ? 'dark' : 'light');
  return page;
}

async function shot(page, name) {
  await page.waitForTimeout(450);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}

const go = (page, path) => page.evaluate((p) => window.__audit.app.config.globalProperties.$router.push(p), path);

/**
 * The connect sheet with stand-ins: links it would open are recorded, the
 * wallet's answer and Coinos' reply come when the check says so, and the
 * connection test answers as `alias`.
 */
const standIn = (page, alias) => page.evaluate((alias) => {
  let c = document.querySelector('.iform-sheet').__vueParentComponent;
  while (c && c.type.name !== 'NWCSetupPage') c = c.parent;
  const vm = c.proxy;
  window.__pairing = { opened: [], answer: null, coinosApproved: false };
  vm.openOutside = (url) => { window.__pairing.opened.push(url); };
  vm.listenForAnswer = (request, onAnswer) => {
    window.__pairing.answer = onAnswer;
    return () => { window.__pairing.answer = null; };
  };
  vm.askWallet = async () => {
    await new Promise((r) => setTimeout(r, 200));
    return window.__pairing.coinosApproved;
  };
  vm.probeConnection = async (url) => window.__probeFor(alias, url);
}, alias);

async function bootSheet(page, path) {
  await page.addInitScript((source) => { window.__probeFor = new Function(`return (${source})`)(); }, probeFor.toString());
  await page.goto(`${base}/#${path}`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await page.locator('.iform-sheet').waitFor({ timeout: 60000 });
}

try {
  // 1 · Welcome: one row for every wallet someone already uses.
  const welcome = await newPage();
  await welcome.goto(`${base}/#/`);
  await welcome.waitForFunction(() => !!window.__audit?.app?._instance, null, { timeout: 120000 });
  await welcome.locator('.bgo-more').click();
  await welcome.getByText('Connect a wallet you already use', { exact: true }).waitFor();
  await welcome.getByText('Alby Hub, Coinos, LNbits and more', { exact: true }).waitFor();
  assert.equal(await welcome.getByText('Nostr Wallet Connect', { exact: true }).count(), 0, 'no protocol name as a row');
  await shot(welcome, 'welcome-more');
  await welcome.locator('[data-audit="welcome-connect-wallet"]').click();
  await welcome.locator('[data-audit="connect-albyhub"]').waitFor();
  console.log('✓ Welcome: one row opens the chooser');
  await welcome.context().close();

  // 2 · The chooser: four ways, BuhoHub apart as information.
  const page = await newPage();
  await bootSheet(page, '/connect-wallet');
  for (const label of ['Alby Hub', 'Coinos', 'LNbits', 'Another wallet']) {
    await page.locator('.connect-choice').filter({ hasText: label }).waitFor();
  }
  assert.equal(await page.locator('.connect-choice').count(), 4);
  assert.equal(await page.locator('.iform-sheet-footer .q-btn').count(), 0, 'rows navigate; no extra button');
  await shot(page, 'chooser');
  await page.locator('[data-audit="connect-buhohub"]').click();
  await page.getByText(/home base behind BuhoGO is on its way/).waitFor();
  assert.equal(await page.locator('[data-audit="connect-buhohub"]').getAttribute('aria-expanded'), 'true');
  await shot(page, 'chooser-buhohub');
  console.log('✓ chooser: Alby Hub, Coinos, LNbits, another wallet; BuhoHub says what it is');

  // 3 · Alby Hub: Alby Cloud by default, an own Hub by address.
  await standIn(page, 'Alby Hub');
  await page.locator('[data-audit="connect-albyhub"]').click();
  await page.getByRole('radio', { name: /Alby Cloud/ }).waitFor();
  assert.equal(await page.getByRole('radio', { name: /Alby Cloud/ }).getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'Scan a code from your Hub' }).waitFor();
  await shot(page, 'hub-ready');
  await page.getByRole('radio', { name: /My own Hub/ }).click();
  await page.locator('.approve-input').fill('not a hub');
  await page.getByRole('button', { name: 'Open Alby Hub', exact: true }).click();
  await page.getByText("That doesn't look like a web address.").waitFor();
  await page.locator('.approve-input').fill('hub.example.com');
  await shot(page, 'hub-own');
  await page.getByRole('button', { name: 'Open Alby Hub', exact: true }).click();
  await page.getByText('Waiting for approval in Alby Hub…').waitFor();
  const opened = await page.evaluate(() => window.__pairing.opened[0]);
  const approval = new URL(opened);
  assert.equal(approval.origin + approval.pathname, 'https://hub.example.com/apps/new');
  assert.match(approval.searchParams.get('pubkey'), /^[a-f0-9]{64}$/);
  assert.ok(!opened.includes('secret'), 'no secret in the link');
  const requestId = new URL(approval.searchParams.get('return_to')).searchParams.get('request');
  assert.ok(requestId);
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  await shot(page, 'hub-waiting');
  console.log('✓ Alby Hub: own address checked, approval link with our key only, waiting with Cancel');

  // 4 · The Hub answers over its relay: tested, then Wallet found.
  await page.evaluate((wallet) => window.__pairing.answer({ walletPubkey: wallet, relays: ['wss://relay.getalby.com'] }), HUB_WALLET);
  await page.locator('.nwc-found__input').waitFor();
  assert.equal(await page.locator('.nwc-found__input').inputValue(), 'Alby Hub');
  await shot(page, 'hub-found');
  // The return address arriving after the relay already answered does nothing.
  await page.evaluate(({ id, wallet }) => {
    let c = document.querySelector('.iform-sheet').__vueParentComponent;
    while (c && c.type.name !== 'NWCSetupPage') c = c.parent;
    return c.proxy.finishFromReturn({ request: id, relay: 'wss://relay.getalby.com', pubkey: wallet });
  }, { id: requestId, wallet: HUB_WALLET });
  await page.locator('.nwc-found__input').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('buhoGO_nwc_pairing')), null, 'request taken');
  console.log('✓ the answer is tested and found; a late return is ignored');

  // 5 · Back to the chooser, then the Hub's return address finishes a request.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('[data-audit="connect-albyhub"]').click();
  await page.getByRole('button', { name: 'Open Alby Hub', exact: true }).click();
  await page.getByText('Waiting for approval in Alby Hub…').waitFor();
  const second = new URL(await page.evaluate(() => window.__pairing.opened.at(-1)));
  assert.equal(second.origin, 'https://hub.example.com', 'the own Hub is remembered');
  const secondId = new URL(second.searchParams.get('return_to')).searchParams.get('request');
  await page.evaluate(({ id, wallet }) => {
    let c = document.querySelector('.iform-sheet').__vueParentComponent;
    while (c && c.type.name !== 'NWCSetupPage') c = c.parent;
    return c.proxy.finishFromReturn({ request: id, relay: ['wss://relay.getalby.com', 'wss://relay2.getalby.com'], pubkey: wallet, lud16: 'maria@getalby.com' });
  }, { id: secondId, wallet: HUB_WALLET });
  await page.locator('.nwc-found__input').waitFor();
  console.log('✓ the return address finishes the waiting request');

  // 6 · Coinos: approve there; BuhoGO asks until Coinos knows the connection.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  // Coinos calls itself after its node; BuhoGO names it Coinos.
  await standIn(page, 'ln.coinos.io');
  await page.locator('[data-audit="connect-coinos"]').click();
  await page.getByText(/Coinos opens so you can approve BuhoGO/).waitFor();
  await shot(page, 'coinos-ready');
  await page.getByRole('button', { name: 'Open Coinos', exact: true }).click();
  await page.getByText('Waiting for approval in Coinos…').waitFor();
  const coinos = new URL(await page.evaluate(() => window.__pairing.opened.at(-1)));
  assert.equal(coinos.origin + coinos.pathname, 'https://coinos.io/apps/new');
  await shot(page, 'coinos-waiting');
  await page.evaluate(() => { window.__pairing.coinosApproved = true; });
  await page.locator('.nwc-found__input').waitFor({ timeout: 10000 });
  assert.equal(await page.locator('.nwc-found__input').inputValue(), 'Coinos');
  console.log('✓ Coinos: approval link with our key, found once Coinos answers');

  // 7 · Another wallet: paste or scan, or a code the wallet app scans.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await standIn(page, 'Alby Go');
  await page.locator('[data-audit="connect-other"]').click();
  await page.getByRole('button', { name: 'Let your wallet scan a code instead' }).waitFor();
  await shot(page, 'other-connect');
  await page.getByRole('button', { name: 'Let your wallet scan a code instead' }).click();
  await page.locator('.code-card canvas, .code-card img').first().waitFor();
  await page.getByText('Waiting for approval…').waitFor();
  const uri = await page.evaluate(() => {
    let c = document.querySelector('.iform-sheet').__vueParentComponent;
    while (c && c.type.name !== 'NWCSetupPage') c = c.parent;
    return c.proxy.codeUri;
  });
  assert.match(uri, /^nostr\+walletauth:\/\/[a-f0-9]{64}\?relay=/);
  assert.match(uri, /&state=[a-f0-9]{32}/);
  await shot(page, 'code');
  await page.evaluate((wallet) => window.__pairing.answer({ walletPubkey: wallet, relays: ['wss://relay.getalby.com'] }), HUB_WALLET);
  await page.locator('.nwc-found__input').waitFor();
  console.log('✓ code: a walletauth request with state; the answer is tested and found');

  // 8 · The code expires; a new one is a tap away.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('[data-audit="connect-other"]').click();
  await page.getByRole('button', { name: 'Let your wallet scan a code instead' }).click();
  await page.locator('.code-card').waitFor();
  await page.evaluate(() => {
    let c = document.querySelector('.iform-sheet').__vueParentComponent;
    while (c && c.type.name !== 'NWCSetupPage') c = c.parent;
    c.proxy.expirePairing();
  });
  await page.getByText('This code has expired.').waitFor();
  await shot(page, 'code-expired');
  await page.getByRole('button', { name: 'Show a new code' }).click();
  await page.locator('.code-card').waitFor();
  console.log('✓ an expired code says so and offers a new one');

  // 9 · Add the wallet; Settings has one row for connecting.
  await page.evaluate((wallet) => window.__pairing.answer({ walletPubkey: wallet, relays: ['wss://relay.getalby.com'] }), HUB_WALLET);
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  await page.waitForFunction(() => location.hash.includes('/wallet'), null, { timeout: 30000 });
  await go(page, '/settings');
  await page.getByText('Manage Wallets', { exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    let c = document.querySelector('.q-page').__vueParentComponent;
    while (c && !('showAddWalletDialog' in (c.proxy?.$data || {}))) c = c.parent;
    c.proxy.showAddWalletDialog = true;
  });
  await page.locator('[data-audit="add-connect-wallet"]').waitFor();
  assert.equal(await page.getByText('Connect NWC Wallet').count(), 0);
  await shot(page, 'settings-add-wallet');
  console.log('✓ Settings: Add New Wallet has one Connect a wallet row');

  // Dark: the chooser and the code.
  const dark = await newPage({ dark: true });
  await bootSheet(dark, '/connect-wallet');
  await dark.locator('[data-audit="connect-albyhub"]').waitFor();
  await shot(dark, 'chooser-dark');
  await standIn(dark, 'Alby Go');
  await dark.locator('[data-audit="connect-other"]').click();
  await dark.getByRole('button', { name: 'Let your wallet scan a code instead' }).click();
  await dark.locator('.code-card').waitFor();
  await shot(dark, 'code-dark');
  await dark.context().close();

  // 10 · A return no one here waits for: hand it to the app on Android,
  // start again anywhere else.
  const elsewhere = await newPage();
  await bootSheet(elsewhere, `/nwc/connected?request=abc&relay=wss%3A%2F%2Frelay.getalby.com&pubkey=${HUB_WALLET}`);
  await elsewhere.getByText('Nothing is waiting for this approval').waitFor();
  await shot(elsewhere, 'return-nothing');
  await elsewhere.context().close();
  const android = await newPage({ userAgent: ANDROID_UA });
  await bootSheet(android, `/nwc/connected?request=abc&relay=wss%3A%2F%2Frelay.getalby.com&pubkey=${HUB_WALLET}`);
  await android.getByText('Finish in the BuhoGO app').waitFor();
  await android.getByRole('button', { name: 'Open BuhoGO' }).waitFor();
  await shot(android, 'return-android');
  await android.context().close();
  console.log('✓ return: Android browser hands over to the app; elsewhere, start again');

  // German, narrow: the longest strings fit.
  const german = await newPage();
  await german.setViewportSize({ width: 320, height: 700 });
  await german.addInitScript(() => localStorage.setItem('buhoGO_language', 'de'));
  await bootSheet(german, '/connect-wallet');
  await german.locator('[data-audit="connect-albyhub"]').click();
  await german.getByText('Dein Hub').first().waitFor();
  await shot(german, 'hub-de-320');
  await german.context().close();

  assert.deepEqual(page.errors, [], 'no page errors');
  console.log('\nAll pairing checks passed.');
} finally {
  await browser.close();
}
