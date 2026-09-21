/** Controlled browser check for the Spark emergency exit. Start `pnpm dev --port 9011` first.
 * Public test words only; the SDK provider and every chain endpoint are stubbed, nothing is broadcast. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.EXIT_BASE_URL || 'http://localhost:9011';
const output = process.env.EXIT_OUTPUT || new URL('../output/emergency-exit', import.meta.url).pathname;
await mkdir(output, { recursive: true });

// Published BIP-39 all-zero test vector sealed with a fixed test-only key (see backup-experience.mjs).
const AUDIT_DEVICE_KEY = 'DRQbIikwNz5FTFNaYWhvdn2Ei5KZoKeutbzDytHY3+Y=';
const AUDIT_SEED_ENVELOPE = 'AQIDBAUGBwgJCgsM5oeZavUf7bRrnLvfrRnjlmYhzZU1ngV33uyJHLa6BRi0XiXABbXW2piRbwX6+3otDTRGQaMsYbx7QIHyaSfxKE7Qpac/6BPd+mj7Cl3m4ODzaCnB384XShC+E5DD5KnMaTm2DzlNtXmT8dL23g==';
const PERSONAL = 'spark-personal-1';
const DESTINATION = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // m/84'/0'/0'/0/0 of the test words
const FUNDING = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';     // m/84'/0'/0'/0/1

const chain = { tip: 900000, statuses: {}, utxos: [], broadcasts: [], fees: { fastestFee: 6, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 } };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.hostname === 'mempool.space') {
    const path = url.pathname;
    if (path.endsWith('/fees/recommended')) return json(chain.fees);
    if (path.endsWith('/blocks/tip/height')) return route.fulfill({ status: 200, body: String(chain.tip) });
    if (/\/address\/[^/]+\/utxo$/.test(path)) return json(chain.utxos);
    const status = path.match(/\/tx\/([^/]+)\/status$/);
    if (status) return chain.statuses[status[1]] ? json(chain.statuses[status[1]]) : route.fulfill({ status: 404, body: 'Transaction not found' });
    if (path.endsWith('/txs/package')) { chain.broadcasts.push(JSON.parse(route.request().postData())); return json({ package_msg: 'success' }); }
    if (path.endsWith('/tx')) { chain.broadcasts.push([route.request().postData()]); return route.fulfill({ status: 200, body: 'txid' }); }
    return route.fulfill({ status: 404, body: '' });
  }
  const passthrough = ['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'];
  return url.origin === base || passthrough.includes(url.hostname) ? route.continue() : route.abort();
});
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(({ key, seed }) => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buho-theme-mode', 'light');
  localStorage.setItem('buhoGO_device_key', key);
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({
    wallets: [
      { id: 'spark-personal-1', name: 'Personal', type: 'spark', balance: 0, metadata: { hasBackedUp: true, sparkAddress: 'spark1personaltestaddress' }, connectionData: { accountNumber: 2, walletGroupId: 'test', network: 'MAINNET', encryptedMnemonic: seed } },
      { id: 'spark-business-1', name: 'Business', type: 'spark', balance: 0, metadata: { hasBackedUp: true, sparkAddress: 'spark1businesstestaddress' }, connectionData: { accountNumber: 1, walletGroupId: 'test', network: 'MAINNET', encryptedMnemonic: seed } },
    ],
    activeWalletId: 'spark-personal-1', preferredFiatCurrency: 'USD', defaultDisplayCurrency: 'sats', denominationCurrency: 'sats',
    exchangeRates: { USD: 95000 }, exchangeRatesAvailable: true, exchangeRatesLastUpdate: Date.now(), hasBackedUp: true, biometricsEnabled: false,
  }));
  const now = Date.now();
  const kit = (walletId) => ({ walletId, network: 'mainnet', checkedAt: now, exportedAt: now, driveAt: now, feeRate: 3, recoverableSat: 89700, notWorthSat: 9900, feeSat: 8800, fundingSat: 8500, arrivesSat: 89400, balanceSat: 99600, leafCount: 4,
    destinationAddress: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', fundingAddress: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g' });
  localStorage.setItem('buhoGO_exit_kit_v1', JSON.stringify({ v: 1, kits: { 'spark-personal-1': kit('spark-personal-1'), 'spark-business-1': kit('spark-business-1') } }));
}, { key: AUDIT_DEVICE_KEY, seed: AUDIT_SEED_ENVELOPE });

let n = 0;
async function shot(name) {
  await page.waitForTimeout(400);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}
const go = path => page.evaluate(p => window.__audit.app.config.globalProperties.$router.push(p), path);
// Drive the page's own tick so the app's driver instance (not a second module copy) does the work.
const tick = () => page.evaluate(async () => {
  let component = document.querySelector('.exit-page')?.__vueParentComponent;
  while (component && component.type.name !== 'EmergencyExitPage') component = component.parent;
  if (!component) throw new Error('exit page not mounted');
  await component.proxy.tick();
});
const exitRecord = () => page.evaluate(id => JSON.parse(JSON.stringify(window.__audit.app.config.globalProperties.$pinia._s.get('emergencyExit').exitFor(id))), PERSONAL);

// A stand-in for the connected Breez provider: quotes, signs nothing itself, returns a four-step chain.
async function injectProvider() {
  await page.evaluate(id => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    const chain = [
      { kind: 'fanOut', txid: 'F', txHex: 'f-hex', dependsOn: [], status: 'unconfirmed' },
      { kind: 'node', txid: 'N', txHex: 'n-hex', cpfpTxHex: 'n-child', dependsOn: ['F'], status: 'unconfirmed' },
      { kind: 'refund', txid: 'R', txHex: 'r-hex', cpfpTxHex: 'r-child', csvTimelockBlocks: 100, dependsOn: ['N'], status: 'unconfirmed' },
      { kind: 'sweep', txid: 'S', txHex: 's-hex', dependsOn: ['R'], status: 'unconfirmed' },
    ];
    store.providers[id] = {
      isConnected: true, calls: [],
      async prepareUnilateralExit(request) { this.calls.push(['prepare', request]); return { recoverableValueSat: 89700, totalFeeSat: 8800, fanoutFeeSat: 300, singleUtxoFundingSat: 8500, feeRateSatPerVbyte: request.feeRateSatPerVbyte, destination: request.destination, leaves: [{ leafId: 'a', value: 50000 }, { leafId: 'b', value: 39700 }], perBranchFunding: [] }; },
      async buildUnilateralExit(request) { this.calls.push(['build', { inputs: request.fundingInputs, signer: typeof request.signer?.signPsbt }]); return { recoverableValueSat: 89700, totalFeeSat: 8800, leaves: [{ leafId: 'a' }, { leafId: 'b' }], transactions: chain }; },
      async exportUnilateralExitState() { return 'x'.repeat(2048); },
      async importUnilateralExitState() {},
      async getBalanceSatsLocal() { return 99600; },
      onExitDataChanged() { return () => {}; },
    };
  }, PERSONAL);
}

try {
  await page.goto(`${base}/#/security`);
  await page.waitForFunction(() => !!window.__audit?.app, { timeout: 120000 });
  await page.getByRole('button', { name: /^Emergency exit kit/ }).waitFor({ timeout: 120000 });
  await page.getByText('Exit kit checked today', { exact: true }).first().waitFor();
  await shot('security-kit-line');
  await page.getByRole('button', { name: /^Emergency exit kit/ }).click();
  await page.locator('.exit-kit-sheet').waitFor();
  await page.getByText('89,700 sats could leave on their own').first().waitFor();
  await shot('kit-sheet');
  await page.getByRole('button', { name: 'How the emergency exit works', exact: true }).click();
  await page.locator('.exit-how-sheet').waitFor();
  await page.getByText('What it is not', { exact: true }).waitFor();
  await shot('how-it-works');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.exit-how-sheet').waitFor({ state: 'detached' });
  console.log('✓ Security shows the kit receipt, the kit sheet and the explainer');

  await injectProvider();
  await page.getByRole('button', { name: /^Emergency exit kit/ }).click();
  await page.locator('.exit-kit-sheet').getByRole('button', { name: /^Emergency exit\b/ }).first().click();
  await page.waitForFunction(() => location.hash.includes('/security/exit/'));
  await page.getByRole('button', { name: 'Start emergency exit', exact: true }).waitFor();
  await page.getByText('Ready to leave on your own', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start emergency exit', exact: true }).isEnabled(), true);
  await shot('exit-ready');

  await page.getByRole('button', { name: /Arrives as plain Bitcoin/ }).click();
  await page.locator('.exit-destination').waitFor();
  await page.locator('.exit-destination input').fill('alice@example.com');
  await page.getByRole('button', { name: 'Use this address', exact: true }).click();
  await page.getByText('Not a Bitcoin address', { exact: true }).waitFor();
  await shot('destination-invalid');
  await page.locator('.exit-destination input').fill(DESTINATION.toUpperCase());
  await page.getByRole('button', { name: 'Use this address', exact: true }).click();
  await page.locator('.exit-destination').waitFor({ state: 'detached' });
  console.log('✓ destination sheet validates plain Bitcoin addresses');

  await page.getByRole('button', { name: 'Start emergency exit', exact: true }).click();
  await page.locator('.exit-error, .exit-stage').first().waitFor();
  if (await page.locator('.exit-error').count()) assert.fail(`start failed: ${await page.locator('.exit-error').innerText()}`);
  await page.getByText('Add fee money', { exact: true }).first().waitFor();
  await page.locator('.exit-address').waitFor();
  assert.equal(await page.locator('.exit-address').innerText(), FUNDING);
  await page.getByText(/Send 8,500 sats of on-chain Bitcoin/).waitFor();
  let exit = await exitRecord();
  assert.equal(exit.stage, 'fund');
  assert.equal(exit.destination.address, DESTINATION);
  await shot('exit-fund');
  console.log('✓ start quotes the exit and asks for fee money on the words-derived address');

  chain.utxos = [{ txid: 'fee', vout: 0, value: 9000, status: { confirmed: false } }];
  await tick();
  assert.equal((await exitRecord()).stage, 'fund');
  chain.utxos = [{ txid: 'fee', vout: 0, value: 9000, status: { confirmed: true, block_height: 900000 } }];
  await tick();
  await page.getByRole('button', { name: 'Send to Bitcoin', exact: true }).waitFor();
  await page.getByText('9,000 sats confirmed', { exact: true }).waitFor();
  await shot('exit-funded');
  await page.getByRole('button', { name: 'Send to Bitcoin', exact: true }).click();
  await page.getByRole('heading', { name: 'Send to Bitcoin now?', exact: true }).waitFor();
  await page.getByText(/89,700 sats leave Spark/).waitFor();
  await shot('exit-confirm');
  await page.locator('.exit-confirm').getByRole('button', { name: 'Send', exact: true }).click();
  // The dialog closes only after signing and the first broadcast pass.
  await page.locator('.exit-confirm').waitFor({ state: 'detached', timeout: 90000 });
  await page.getByText('On its way', { exact: true }).first().waitFor();
  exit = await exitRecord();
  assert.equal(exit.stage, 'send');
  assert.equal(exit.lastError, null);
  assert.deepEqual(chain.broadcasts, [['f-hex']]);
  const build = await page.evaluate(id => window.__audit.app.config.globalProperties.$pinia._s.get('wallet').providers[id].calls.find(c => c[0] === 'build')[1], PERSONAL);
  assert.equal(build.signer, 'function', 'the SDK signer was created from the fee money key');
  assert.deepEqual(build.inputs.map(i => [i.type, i.txid, i.value]), [['p2wpkh', 'fee', 9000]]);
  await shot('exit-sending');
  console.log('✓ confirmation signs with the SDK signer and broadcasts the first package only');

  chain.statuses.F = { confirmed: true, block_height: 900001 }; chain.tip = 900001;
  await tick();
  assert.deepEqual(chain.broadcasts.at(-1), ['n-hex', 'n-child']);
  chain.statuses.N = { confirmed: true, block_height: 900002 }; chain.tip = 900002;
  await tick();
  exit = await exitRecord();
  assert.equal(exit.stage, 'unlock');
  assert.equal(exit.unlock.height, 900102);
  await page.getByText(/Unlocks around/).first().waitFor();
  await page.getByText(/blocks left, about/).waitFor();
  await shot('exit-unlock');
  chain.tip = 900101;
  await tick();
  assert.deepEqual(chain.broadcasts.at(-1), ['r-hex', 'r-child']);
  chain.statuses.R = { confirmed: true, block_height: 900102 }; chain.tip = 900102;
  await tick();
  assert.deepEqual(chain.broadcasts.at(-1), ['s-hex']);
  chain.statuses.S = { confirmed: true, block_height: 900103 }; chain.tip = 900103;
  await tick();
  await page.getByText('Your money is plain Bitcoin now', { exact: true }).waitFor();
  await page.getByText(/89,400 sats arrived at/).waitFor();
  await shot('exit-done');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Start emergency exit', exact: true }).waitFor();
  console.log('✓ packages go out in dependency order, the timelock is waited out, the sweep finishes the exit');

  await page.getByRole('button', { name: 'Start emergency exit', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel exit', exact: true }).click();
  await page.getByRole('button', { name: 'Start emergency exit', exact: true }).waitFor();
  assert.equal(await exitRecord(), null);
  console.log('✓ an unsigned exit can be cancelled');

  // Home: the door after a sustained outage, the chip while an exit runs.
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('buhoGO_spark_health_v1', JSON.stringify({ 'spark-personal-1': { lastSuccessAt: now - 8 * 3600e3, firstFailureAt: now - 7 * 3600e3, failures: 3 } }));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__audit?.app, { timeout: 120000 });
  await go('/wallet');
  await page.getByText('Spark is not responding', { exact: true }).waitFor({ timeout: 60000 });
  await shot('home-banner');
  // A consistent record: a signed chain whose tree is confirmed and whose refund waits on its timelock.
  chain.statuses.F2 = { confirmed: true, block_height: 900100 };
  chain.statuses.N2 = { confirmed: true, block_height: 900101 };
  await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('emergencyExit');
    const transactions = [
      { kind: 'fanOut', txid: 'F2', txHex: 'f2', dependsOn: [], csvTimelockBlocks: 0 },
      { kind: 'node', txid: 'N2', txHex: 'n2', cpfpTxHex: 'n2c', dependsOn: ['F2'], csvTimelockBlocks: 0 },
      { kind: 'refund', txid: 'R2', txHex: 'r2', cpfpTxHex: 'r2c', dependsOn: ['N2'], csvTimelockBlocks: 1400 },
      { kind: 'sweep', txid: 'S2', txHex: 's2', dependsOn: ['R2'], csvTimelockBlocks: 0 },
    ];
    store.set({ v: 1, walletId: 'spark-personal-1', stage: 'unlock', createdAt: Date.now(), updatedAt: Date.now(), destination: { address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' }, funding: { address: 'x', utxos: [], confirmedSat: 9000, requiredSat: 8500, shortfallSat: 0, confirmedAt: Date.now() }, quote: { recoverableValueSat: 89700, totalFeeSat: 8800, singleUtxoFundingSat: 8500, feeRateSatPerVbyte: 4, leafIds: [] }, triage: { recoverableSat: 89700, notWorthSat: 9900 }, built: { transactions, totalFeeSat: 8800, recoverableValueSat: 89700 }, statuses: { F2: { known: true, confirmed: true, blockHeight: 900100 }, N2: { known: true, confirmed: true, blockHeight: 900101 } }, tipHeight: 900103, unlock: { height: 901501, blocksLeft: 1397, estimatedAt: Date.now() + 14 * 86400e3 }, progress: { confirmed: 2, total: 4 } });
  });
  await page.getByRole('button', { name: 'Exit in progress', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByText('Spark is not responding', { exact: true }).waitFor({ state: 'detached' });
  await shot('home-chip');
  await page.getByRole('button', { name: 'Exit in progress', exact: true }).click();
  await page.waitForFunction(() => location.hash.includes('/security/exit/spark-personal-1'));
  await page.getByText(/Unlocks around/).first().waitFor();
  await shot('exit-unlock-resumed');
  console.log('✓ home shows the door after a sustained outage and the chip while an exit runs');

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(async () => {
    const { applyLocale } = await import('/src/i18n/locales.js');
    applyLocale(window.__audit.app._instance.proxy.$i18n, 'de');
    document.documentElement.style.fontSize = '32px';
  });
  await page.waitForTimeout(600);
  const german = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160));
  await page.getByText(/Freigabe etwa am/).first().waitFor({ timeout: 10000 }).catch(error => { console.log('page text:', german); throw error; });
  await shot('exit-unlock-de-320-200pct');
  console.log('✓ German at 320px and 200% text');

  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} catch (error) {
  console.log('page errors:', errors);
  throw error;
} finally { await browser.close(); }
