/** After the app was closed: do the saved Auto-Transfer rules start watching
 * again on a cold start, and how soon? A real boot (no audit harness) with two
 * saved NWC wallets: "Main" is active (Home reads it anyway), "Hub" is not and
 * has a rule. Only the watch reads Hub, and reading it means connecting to its
 * relay, so the first connection attempt to Hub's relay is when the rule got
 * its first chance. Spark wallets are checked from the start by the Spark
 * lifecycle and are not part of this check.
 * Start `pnpm dev --port 9031` first (or set AT_BASE_URL). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.AT_BASE_URL || 'http://localhost:9031';
const LIMIT_S = Number(process.env.AT_LIMIT_S || 15);
const nwc = (relay) => `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2F${relay}&secret=${'5e'.repeat(32)}`;
const methods = ['pay_invoice', 'make_invoice', 'get_balance'];
const saved = {
  balanceSchemaVersion: 1,
  sparkModelVersion: 2,
  activeWalletId: 'main',
  wallets: [
    { id: 'main', type: 'nwc', name: 'Main', nwcUrl: nwc('relay.main.example'), metadata: { methods }, createdAt: 1, lastUsed: 2 },
    { id: 'hub', type: 'nwc', name: 'Hub', nwcUrl: nwc('relay.rule.example'), metadata: { methods }, createdAt: 2, lastUsed: 1 },
  ],
};
const rules = { configs: { hub: { enabled: true, threshold: { sats: 1000 }, destination: { kind: 'wallet', walletId: 'main' }, events: [] } } };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const attempts = [];
const started = Date.now();
await page.routeWebSocket('**', (socket) => {
  const host = new URL(socket.url()).host;
  if (host === new URL(base).host) return socket.connectToServer();
  attempts.push({ host, at: (Date.now() - started) / 1000 });
  socket.close();
});
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname) ? route.continue() : route.abort();
});
await page.addInitScript(([saved, rules]) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify(saved));
  localStorage.setItem('buhoGO_auto_withdraw', JSON.stringify(rules));
}, [saved, rules]);
await page.goto(`${base}/#/wallet`);
await page.waitForFunction((limit) => performance.now() > limit * 1000, LIMIT_S + 3, { timeout: (LIMIT_S + 10) * 1000, polling: 500 });

const first = (host) => attempts.find((a) => a.host === host)?.at;
console.log('first connection to the active wallet (Home):', first('relay.main.example'), 's');
console.log('first connection to the rule\'s wallet (watch):', first('relay.rule.example'), 's');
await browser.close();
assert.ok(first('relay.rule.example') != null && first('relay.rule.example') <= LIMIT_S, `the rule's wallet is read within ${LIMIT_S} s of a cold start`);
console.log(`✓ after a cold start the saved rule is watched again within ${LIMIT_S} s`);
