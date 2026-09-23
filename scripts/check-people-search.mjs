// Isolated browser integration: real nostr-core, signed fixture events,
// real address-book persistence. External sockets and HTTP are intercepted.
import { chromium } from '@playwright/test';
import { finalizeEvent, nip19 } from 'nostr-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.PEOPLE_SEARCH_BASE_URL || 'http://localhost:9012';
const output = 'output/people-search';
await mkdir(output, { recursive: true });
const makeProfile = (n, profile) => finalizeEvent({ kind: 0, created_at: 1790000000, tags: [], content: JSON.stringify(profile) }, new Uint8Array(32).fill(n));
const alice = makeProfile(1, { name: 'Alice', nip05: 'alice@example.com', about: 'Building useful things with Bitcoin. Say hello.', lud16: 'alice@example.com' });
const aliceTwo = makeProfile(2, { name: 'Alice Smith', about: 'Designer, traveller, and coffee enthusiast.' });
const bob = makeProfile(3, { name: 'Bob', nip05: 'bob@example.com', lud16: 'bob@example.com' });
const people = Array.from({ length: 45 }, (_, index) => makeProfile(index + 10, { name: `People ${index + 1}`, about: 'A public profile for pagination testing.' }));
let failMore = false;
const requests = [], closes = [], errors = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'example.com' && url.pathname === '/.well-known/nostr.json') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ names: { bob: bob.pubkey } }) });
  }
  if (url.hostname === 'mempool.space') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
  if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
  return route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) return socket.connectToServer();
  socket.onMessage(raw => {
    const [type, id, filter] = JSON.parse(String(raw));
    if (type === 'CLOSE') { closes.push(id); return; }
    if (type !== 'REQ') return;
    requests.push({ url: socket.url(), filter });
    const send = message => { try { socket.send(JSON.stringify(message)); } catch { /* cancelled */ } };
    if (filter.search === 'unavailable') return send(['CLOSED', id, 'rate-limited']);
    if (filter.search === 'slow') return;
    if (filter.search === 'people' && filter.limit > 20 && failMore) return send(['CLOSED', id, 'rate-limited']);
    const events = filter.authors ? [alice, aliceTwo, bob].filter(event => filter.authors.includes(event.pubkey))
      : filter.search === 'people' ? people.slice(0, filter.limit)
      : filter.search?.toLowerCase().includes('alice') ? [aliceTwo, alice, bob] : [];
    for (const event of events) send(['EVENT', id, event]);
    setTimeout(() => send(['EOSE', id]), 150);
  });
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedNpub = value; } } });
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
});
const input = () => page.getByRole('searchbox', { name: 'Search people' });
const pane = page.locator('.search-pane');
async function open() {
  await page.locator('.add-contact-btn').click();
  await page.locator('.seg-tab').getByText('Search', { exact: true }).click();
  await input().waitFor();
}
async function results() {
  await input().fill('alice');
  await page.getByText('Choose a person to view their profile.', { exact: true }).waitFor();
}
async function shot(name) { await page.screenshot({ path: `${output}/${name}.png` }); }

try {
  await page.goto(`${base}/#/address-book`);
  await page.locator('.add-contact-btn').waitFor();
  await open();
  await input().fill('a');
  await page.waitForTimeout(450);
  assert.equal(requests.length, 0);
  await input().fill('nostr:nsec1thismustneverleavethedevice');
  await page.waitForTimeout(450);
  assert.equal(requests.length, 0);
  await page.getByText('This is a private key. Use a public identifier instead.', { exact: true }).waitFor();
  await input().fill('al');
  await page.waitForTimeout(100);
  await results();
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.filter.search === 'alice'));
  assert.deepEqual(requests.map(request => new URL(request.url).hostname).sort(), ['relay.ditto.pub', 'relay.dreamith.to']);
  assert.equal(await page.locator('.people-result').count(), 2);
  assert.match(await page.locator('.people-name').first().textContent(), /^Alice$/);
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.__audit.setDark(dark), dark);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await shot(`results-${dark ? 'dark' : 'light'}`);
  }
  assert.equal(await page.locator('.people-results').getByText(/^npub1/).count(), 0);
  await input().press('ArrowDown');
  assert.equal(await page.locator('.people-result').first().evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  await page.locator('.nostr-preview').waitFor();
  await page.locator('.preview-copy-key').click();
  assert.equal(await page.evaluate(() => window.copiedNpub), nip19.npubEncode(alice.pubkey));
  assert.equal(await page.locator('#people-search-status').count(), 0);
  await page.evaluate(async () => { const { toastItems, toastController } = await import('/src/services/toasts.js'); toastItems.value.forEach(toast => toastController.dismiss(toast.id)); });
  await shot('preview-back-header');
  assert.equal(await page.locator('.preview-handle-icon--verified').count(), 0, 'self-claimed NIP-05 must not get a verification badge');
  await page.getByRole('button', { name: 'Back to results' }).click();
  assert.equal(await page.locator('.people-result').first().evaluate(node => node === document.activeElement), true);
  await page.locator('.people-result').nth(1).click();
  await pane.getByRole('button', { name: 'Save to address book' }).click();
  await page.locator('.address-modal').waitFor({ state: 'hidden' });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('buhoGO_address_book')));
  assert.equal(saved[0].nostr_pubkey, aliceTwo.pubkey);
  assert.equal(saved[0].address, '');
  await open();
  await results();
  await page.locator('.people-result').nth(1).click();
  await pane.getByText('Already in your address book', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to results' }).click();
  console.log('PASS: debounce, private-key guard, relay defaults, signature-backed results, keyboard navigation, preview, identity-only save and duplicate recognition');

  const beforeDirect = requests.length;
  await input().fill(nip19.npubEncode(bob.pubkey));
  await page.locator('.preview-name').getByText('Bob', { exact: true }).waitFor();
  assert.ok(requests.slice(beforeDirect).every(request => request.filter.authors && !request.filter.search));
  await input().fill('bob@example.com');
  await page.locator('.preview-handle-icon--verified').waitFor();
  await input().fill('slow');
  await page.getByText('Searching for people…', { exact: true }).waitFor();
  await page.waitForTimeout(100);
  const beforeClear = closes.length;
  await pane.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok(closes.length >= beforeClear + 2);
  assert.equal(await page.locator('.nostr-preview').count(), 0);
  assert.equal(await page.locator('.people-result').count(), 0);
  await input().fill('nobody');
  await page.getByText('No matching people found. Try another name or a public identifier.', { exact: true }).waitFor();
  await input().fill('unavailable');
  await page.getByText('Search is unavailable right now. Please try again.', { exact: true }).waitFor();
  await pane.getByRole('button', { name: 'Try again' }).click();
  await page.getByText('Search is unavailable right now. Please try again.', { exact: true }).waitFor();
  await shot('unavailable-dark');
  await input().fill('slow');
  await page.waitForTimeout(500);
  const beforeTab = closes.length;
  await page.locator('.seg-tab').getByText('Enter', { exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(closes.length >= beforeTab + 2);
  console.log('PASS: direct npub/NIP-05, actual NIP-05 verification, clear/tab cancellation, empty state and unavailable/retry state');

  await page.locator('.seg-tab').getByText('Search', { exact: true }).click();
  await results();
  await input().fill('people');
  await page.getByText('Choose a person to view their profile.', { exact: true }).waitFor();
  assert.equal(await page.locator('.people-result').count(), 20);
  const scroller = page.locator('.search-scroll');
  const headerBefore = await page.locator('.modal-header').boundingBox();
  const inputBefore = await input().boundingBox();
  failMore = true;
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.getByText('Could not load more people. Your results are still here.', { exact: true }).waitFor();
  assert.equal(await page.locator('.people-result').count(), 20);
  failMore = false;
  await page.locator('.search-pagination').getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.people-result').length === 40);
  assert.deepEqual(await page.locator('.modal-header').boundingBox(), headerBefore);
  assert.deepEqual(await input().boundingBox(), inputBefore);
  const scrollBefore = await scroller.evaluate(node => node.scrollTop);
  await page.locator('.people-result').nth(19).click();
  await page.getByRole('button', { name: 'Back to results' }).click();
  assert.ok(Math.abs(await scroller.evaluate(node => node.scrollTop) - scrollBefore) < 2);
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.getByText('All available results shown.', { exact: true }).waitFor();
  assert.equal(await page.locator('.people-result').count(), 45);
  const countAtEnd = requests.length;
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.waitForTimeout(300);
  assert.equal(requests.length, countAtEnd);
  assert.deepEqual(await input().boundingBox(), inputBefore);
  await shot('pagination-fixed-header');
  console.log('PASS: fixed header/input, automatic 20→40→45 loading, retry without losing results, exhausted state, and Back restores scroll position');
  await results();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(async () => {
    document.documentElement.style.fontSize = '24px';
    document.querySelector('.search-pane').__vueParentComponent.proxy.$i18n.locale = 'de';
  });
  await page.locator('.modal-title').getByText('Kontakt hinzufügen', { exact: true }).waitFor();
  assert.ok(await pane.evaluate(node => node.scrollWidth <= node.clientWidth));
  assert.ok(await page.locator('.people-result').first().evaluate(node => node.getBoundingClientRect().height >= 44));
  await shot('narrow-large-text-german');
  await page.evaluate(async () => {
    document.documentElement.style.removeProperty('font-size');
    document.querySelector('.search-pane').__vueParentComponent.proxy.$i18n.locale = 'es';
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.evaluate(() => window.__audit.setDark(false));
  await page.locator('.modal-title').getByText('Agregar contacto', { exact: true }).waitFor();
  await shot('desktop-spanish');
  assert.deepEqual(errors, []);
  console.log('PASS: light/dark layouts, narrow viewport, larger text, German and Spanish');
} finally {
  await browser.close();
}
