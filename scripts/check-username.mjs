/**
 * Username (paid NIP-05) UI check. Start `npx quasar dev --port 9007` first.
 *
 * Renders every username state with the name server mocked: no key, invoice
 * or payment leaves the machine. External hosts are blocked except the icon
 * and font CDNs. Screenshots land in USERNAME_OUTPUT (default
 * output/username), light and dark.
 *
 *   node scripts/check-username.mjs
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.USERNAME_BASE_URL || 'http://localhost:9007';
const output = process.env.USERNAME_OUTPUT || 'output/username';
await mkdir(output, { recursive: true });

const OTHER_KEY = 'cd'.repeat(32);
const TAKEN = new Set(['maria', 'mariaold', 'drshift']);
const pricePerYear = (name) => (name.length <= 3 ? 10000 : name.length === 4 ? 4000 : name.length <= 6 ? 2000 : 1000);
let myKey = '';
const paymentChecks = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (url.origin === base) return route.continue();
  if (['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
  if (url.hostname !== 'timecatcher.lnbits.de') return route.abort();

  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const path = url.pathname;
  if (path.endsWith('/search')) {
    const q = url.searchParams.get('q');
    const years = Number(url.searchParams.get('years') || 1);
    if (TAKEN.has(q)) return json({ identifier: q, available: false });
    return json({ identifier: q, available: true, price_in_sats: pricePerYear(q) * years, currency: 'sats' });
  }
  if (path.endsWith('/nostr.json')) {
    const name = url.searchParams.get('name');
    const owner = name === 'maria' ? OTHER_KEY : name === 'mariaold' ? myKey : '';
    return json({ names: owner ? { [name]: owner } : {}, relays: {} });
  }
  if (path.includes('/payments/')) {
    paymentChecks.push(path);
    return json({ paid: false });
  }
  if (path.endsWith('/address') && route.request().method() === 'POST') {
    const body = JSON.parse(route.request().postData() || '{}');
    const sats = pricePerYear(body.local_part) * (body.years || 1);
    return json({
      id: 'addr-1',
      local_part: body.local_part,
      payment_request: `lnbc${sats / 100}u1pjq${'x'.repeat(180)}`,
      payment_hash: 'ab'.repeat(32),
      rotation_secret: 'rot-test',
    }, 201);
  }
  return json({ detail: 'not mocked' }, 404);
});
await page.routeWebSocket('**', (socket) => socket.close());
await page.addInitScript(() => {
  // The blank page between states has no storage; only set up the app.
  if (!location.protocol.startsWith('http')) return;
  window.__AUDIT__ = { theme: 'light' };
  localStorage.setItem('buhoGO_language', 'en-US');
  if (!localStorage.getItem('buhoGO_wallet_store')) {
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  }
});

const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${output}/${name}.png` });
  console.log(`  ▸ ${name}.png`);
};
// A hash-only change would not reload the app, and the stores would keep
// the state from before a seed; leave the page first so each state loads
// fresh from storage.
const go = async (hash) => {
  await page.goto('about:blank');
  await page.goto(`${base}/#${hash}`);
  await page.waitForFunction(() => !!window.__audit?.app);
  await page.waitForTimeout(700);
};
const setDark = (dark) => page.evaluate((d) => window.__audit.setDark(d), dark);
const sheet = page.locator('.claim-sheet');

/** Write the active identity's profile blob and purchase record, then reload. */
async function seed({ displayName = '', nip05 = '', expiresAt = null, pending = null } = {}) {
  await page.evaluate(({ displayName, nip05, expiresAt, pending }) => {
    const meta = JSON.parse(localStorage.getItem('buhoGO_identity_v1'));
    const key = meta.nostrPubkeyHex;
    const profile = { version: 1 };
    if (displayName) { profile.displayName = displayName; profile.name = displayName; }
    if (nip05) profile.nip05 = nip05;
    localStorage.setItem(`buhoGO_profile_v1_${key}`, JSON.stringify(profile));
    const local = nip05 ? nip05.split('@')[0] : '';
    meta.nip05Handles = local
      ? [{ handle: local, rotationSecret: 'rot', isFree: false, isActive: true, addressId: 'a', createdAt: 1, expiresAt }]
      : [];
    meta.pendingNip05Claims = pending ? { [key]: { createdAt: Date.now(), ...pending } } : {};
    localStorage.setItem('buhoGO_identity_v1', JSON.stringify(meta));
  }, { displayName, nip05, expiresAt, pending });
}

/** Give the harness one connected wallet with a balance (no provider). */
async function seedWallet(balance) {
  await page.evaluate((amount) => {
    const wallet = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    wallet.wallets = [{ id: 'w1', name: 'Personal', type: 'spark' }];
    wallet.activeWalletId = 'w1';
    wallet.connectionStates = { w1: { connected: true } };
    wallet.balances = { w1: amount };
  }, balance);
}

try {
  console.log('username check');

  // ── No username ────────────────────────────────────────────────────────
  await go('/identity');
  await page.locator('.id-card-front').waitFor();
  myKey = await page.evaluate(() => JSON.parse(localStorage.getItem('buhoGO_identity_v1')).nostrPubkeyHex);
  assert.match(myKey, /^[0-9a-f]{64}$/);
  const line = page.locator('.id-card-ident');
  assert.match(await line.innerText(), /^npub1/);
  assert.equal(await line.getAttribute('aria-label'), 'Copy public code');
  await shot('01-home-fresh');

  await seed({ displayName: 'Maria Schmidt' });
  await go('/identity');
  await page.getByText('Choose a username', { exact: true }).waitFor();
  await page.getByText('mariaschmidt@mybuho.de is available', { exact: true }).waitFor();
  assert.equal(await page.locator('.ladder').count(), 0, 'setup ladder gone once the name is set');
  await shot('02-home-suggestion');

  await page.getByRole('button', { name: 'Not now' }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.getByText('Choose a username', { exact: true }).count(), 0, 'dismissed for good');
  await page.evaluate(() => {
    const meta = JSON.parse(localStorage.getItem('buhoGO_identity_v1'));
    const blob = JSON.parse(localStorage.getItem(`buhoGO_profile_v1_${meta.nostrPubkeyHex}`));
    delete blob.usernameSuggestionDismissedAt;
    localStorage.setItem(`buhoGO_profile_v1_${meta.nostrPubkeyHex}`, JSON.stringify(blob));
  });
  console.log('✓ home: public code line, one calm suggestion after the name, dismissible');

  await go('/identity/profile');
  await page.locator('.username-group').scrollIntoViewIfNeeded();
  await page.getByText('Optional. A short name people can type to find you.', { exact: true }).waitFor();
  await shot('03-profile-none');

  await go('/identity/username');
  await page.getByText('A short name people can type to find you. Paid per year.', { exact: true }).waitFor();
  await shot('04-username-page-none');
  console.log('✓ Edit profile and the username page before a claim');

  // ── Choosing ───────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Choose a username' }).click();
  await sheet.waitFor();
  await sheet.getByText('Available · 1,000 sats a year', { exact: true }).waitFor();
  assert.equal(await sheet.locator('.claim-input').inputValue(), 'mariaschmidt', 'pre-filled from the name');
  await sheet.getByRole('button', { name: 'Pay from another wallet' }).waitFor();
  await shot('05-sheet-available-no-wallet');

  await seedWallet(42310);
  await sheet.getByRole('button', { name: 'Get it for 1,000 sats' }).waitFor();
  await shot('06-sheet-available');

  await sheet.getByRole('button', { name: 'More years' }).click();
  await sheet.getByRole('button', { name: 'More years' }).click();
  await sheet.getByRole('button', { name: 'Get it for 3,000 sats' }).waitFor();
  assert.match(await sheet.locator('.claim-summary').innerText(), /^3 years, until .* · 3,000 sats/);
  await shot('07-sheet-three-years');
  for (let i = 0; i < 12; i += 1) await sheet.getByRole('button', { name: 'More years' }).click({ force: true }).catch(() => {});
  assert.equal(await sheet.getByRole('button', { name: 'More years' }).isDisabled(), true, 'stops at 10 years');
  await sheet.getByRole('button', { name: 'Get it for 10,000 sats' }).waitFor();
  console.log('✓ per-year price, 1 to 10 years, total and end date before the button');

  const input = sheet.locator('.claim-input');
  await input.fill('Maria');
  await input.dispatchEvent('input');
  await sheet.getByText('Taken', { exact: true }).waitFor();
  await sheet.locator('.claim-suggestion').first().waitFor();
  assert.deepEqual(await sheet.locator('.claim-suggestion').allInnerTexts(), ['mariaschmidt@mybuho.de', 'maria.s@mybuho.de']);
  await shot('08-sheet-taken');

  await input.fill('maria!');
  await input.dispatchEvent('input');
  await sheet.getByText('Use a to z, 0 to 9, dot, hyphen or underscore', { exact: true }).waitFor();
  await shot('09-sheet-characters');

  await input.fill(' @María Old ');
  await input.dispatchEvent('input');
  assert.equal(await input.inputValue(), 'mariaold', 'accents, spaces and @ are cleaned while typing');
  await sheet.getByText('Already yours', { exact: true }).waitFor();
  await sheet.getByRole('button', { name: 'Use this name' }).waitFor();
  await shot('10-sheet-already-yours');
  console.log('✓ taken with suggestions, character hint, quiet cleanup, already yours');

  await sheet.getByRole('button', { name: 'Prices' }).click();
  await sheet.getByText('Prices are per year. Pay for up to 10 years at once. Shorter names are rarer, so they cost more.', { exact: true }).waitFor();
  await shot('11-sheet-prices');
  // Tap the dim layer outside the popover, as a person would.
  const dim = await sheet.locator('.pricing-dismiss').boundingBox();
  await page.mouse.click(dim.x + 24, dim.y + dim.height - 24);
  await sheet.locator('.pricing-popover').waitFor({ state: 'detached' });

  await input.fill('mariaschmidt');
  await input.dispatchEvent('input');
  await sheet.getByRole('button', { name: 'Pay from another wallet' }).click();
  await sheet.locator('.claim-qr').waitFor();
  await sheet.getByText('Waiting for the payment', { exact: true }).waitFor();
  await page.waitForTimeout(2600);
  assert.ok(paymentChecks.length >= 1, 'the sheet watches an outside payment by asking the name server');
  const pending = await page.evaluate(() => {
    const meta = JSON.parse(localStorage.getItem('buhoGO_identity_v1'));
    return meta.pendingNip05Claims[meta.nostrPubkeyHex];
  });
  assert.equal(pending.handle, 'mariaschmidt');
  assert.equal(pending.years, 10, 'the chosen years carry over when the name changes');
  assert.match(await sheet.locator('.claim-summary').innerText(), /^10 years, until /);
  await shot('12-sheet-other-wallet');
  console.log('✓ paying from another wallet shows the code, keeps the claim and watches for payment');
  await page.keyboard.press('Escape');

  // ── After the tap ──────────────────────────────────────────────────────
  await seed({ displayName: 'Maria Schmidt', pending: { handle: 'mariaschmidt', paymentHash: 'ab'.repeat(32), years: 1, paidAt: Date.now() } });
  await go('/identity');
  await page.getByText('Almost ready', { exact: true }).waitFor();
  await page.getByText('mariaschmidt@mybuho.de will be on your card in a moment', { exact: true }).waitFor();
  await shot('13-home-almost-ready');

  await seed({ displayName: 'Maria Schmidt', pending: { handle: 'mariaschmidt', paymentHash: 'ab'.repeat(32), years: 1, paidAt: Date.now(), failedAt: Date.now() } });
  await go('/identity');
  await page.getByText("We couldn't finish this name", { exact: true }).waitFor();
  await shot('14-home-couldnt-finish');
  console.log('✓ home reports a finishing and a lost purchase');

  // ── With a username ────────────────────────────────────────────────────
  const until = Date.UTC(2028, 8, 24);
  await seed({ displayName: 'Maria Schmidt', nip05: 'mariaschmidt@mybuho.de', expiresAt: until });
  await go('/identity');
  await page.locator('.id-card-ident .nostr-address').waitFor();
  assert.equal(await page.locator('.id-card-ident').innerText(), 'mariaschmidt@mybuho.de');
  assert.equal(await page.locator('.id-card-ident .nostr-address-check').count(), 1, 'verified badge in front of the address');
  assert.equal(await page.locator('.id-card-ident').getAttribute('aria-label'), 'Copy username mariaschmidt@mybuho.de');
  assert.equal(await page.getByText('Choose a username', { exact: true }).count(), 0);
  await shot('15-home-username');

  await go('/identity/profile');
  await page.locator('.username-group').scrollIntoViewIfNeeded();
  await shot('16-profile-username');

  await go('/identity/username');
  await page.getByText('Until Sep 24, 2028', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Change username' }).waitFor();
  await shot('17-username-page');

  await go('/identity');
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByText('Public code', { exact: true }).waitFor();
  await page.getByText('Someone can scan this to save you as a contact', { exact: true }).first().waitFor();
  await page.locator('.share-identifiers').scrollIntoViewIfNeeded();
  await shot('18-share-sheet');
  await page.keyboard.press('Escape');
  console.log('✓ card, Edit profile, username page with end date, Share sheet with both identifiers');

  // ── Dark ───────────────────────────────────────────────────────────────
  await setDark(true);
  await go('/identity');
  await setDark(true);
  await shot('19-dark-home-username');
  await go('/identity/username');
  await setDark(true);
  await page.getByRole('button', { name: 'Change username' }).click();
  await sheet.waitFor();
  await seedWallet(42310);
  await sheet.locator('.claim-input').fill('maria2');
  await sheet.locator('.claim-input').dispatchEvent('input');
  await sheet.getByText('Available · 2,000 sats a year', { exact: true }).waitFor();
  await shot('20-dark-sheet-change');
  console.log('✓ dark');

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('\nall username checks passed');
} catch (error) {
  await page.screenshot({ path: `${output}/FAILED.png` }).catch(() => {});
  console.error(`✗ failed, see ${output}/FAILED.png`);
  throw error;
} finally {
  await browser.close();
}
