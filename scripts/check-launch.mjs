/** Browser check for the launch (utils/launch.js, components/LaunchMark.vue):
 * the launch frame is replaced by the identical first frame, the mark travels
 * into the toolbar, home never replays it, a returning person never sees the
 * welcome screen, and the mark breathes while the wallets are slow.
 * Start `pnpm dev --port 9031` first (or set LAUNCH_BASE_URL). Screenshots go
 * to output/launch-check/. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.LAUNCH_BASE_URL || 'http://localhost:9031';
const output = process.env.LAUNCH_OUTPUT || new URL('../output/launch-check', import.meta.url).pathname;
await mkdir(output, { recursive: true });

const SAVED = JSON.stringify({ activeWalletId: 'main', wallets: [{ id: 'main', type: 'lnbits', name: 'Main', metadata: {}, createdAt: 1, lastUsed: 1 }] });
const browser = await chromium.launch({ headless: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function open({ theme = 'light', saved = true, path = '/#/wallet', reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.routeWebSocket('**', (socket) => { if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close(); });
  await page.addInitScript(({ theme, saved }) => {
    window.__AUDIT__ = { theme, launch: true, noExitMonitor: true };
    localStorage.setItem('buho.theme', theme);
    localStorage.setItem('buhoGO_language', 'en-US');
    if (saved) localStorage.setItem('buhoGO_wallet_store', saved);
    // What drew, in order: the welcome screen must never mount for a returning person.
    window.__seen = new Set();
    new MutationObserver(() => {
      if (document.querySelector('.welcome-page')) window.__seen.add('welcome');
      if (document.querySelector('.launch')) window.__seen.add('launch');
      if (document.querySelector('.launch--travel')) window.__seen.add('travel');
      if (document.querySelector('.launch--fade')) window.__seen.add('fade');
    }).observe(document, { childList: true, subtree: true });
  }, { theme, saved: saved ? SAVED : null });
  await page.goto(`${base}${path}`);
  return { page, context, errors };
}

/** The launch came and went (waiting for "gone" alone passes before it came). */
async function launched(page) {
  await page.waitForFunction(() => window.__seen?.has('launch') && !document.querySelector('.launch'), null, { timeout: 90000 });
}

const logoVisible = (page) => page.evaluate(() => {
  const logo = document.querySelector('.app-logo');
  return !!logo && getComputedStyle(logo).visibility === 'visible';
});

// 1 · The quick path, light and dark: frame → identical first frame → travel → toolbar.
for (const theme of ['light', 'dark']) {
  const { page, context, errors } = await open({ theme });
  await page.waitForSelector('.launch', { timeout: 90000 });
  assert.equal(await page.locator('#launch-frame').count(), 0, 'the launch frame goes once the app draws the same picture');
  await page.screenshot({ path: `${output}/${theme}-1-first-frame.png` });
  await page.waitForSelector('.launch--travel', { timeout: 5000 });
  await pause(220);
  await page.screenshot({ path: `${output}/${theme}-2-travel.png` });
  await page.waitForSelector('.launch', { state: 'detached', timeout: 5000 });
  assert.equal(await logoVisible(page), true, 'the toolbar logo shows once the mark has landed');
  await pause(300);
  await page.screenshot({ path: `${output}/${theme}-3-home.png` });
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ launch frame → first frame → the mark travels into the toolbar (light and dark)');

// 2 · Coming back home never replays the launch.
{
  const { page, context } = await open();
  await launched(page);
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/settings'));
  await pause(800);
  await page.evaluate(() => { window.__seen.delete('launch'); window.__audit.app.config.globalProperties.$router.push('/wallet'); });
  await page.waitForSelector('.wallet-toolbar', { timeout: 20000 });
  await pause(800);
  assert.equal(await page.evaluate(() => window.__seen.has('launch')), false, 'no launch on the way back');
  assert.equal(await logoVisible(page), true);
  await context.close();
}
console.log('✓ returning to home does not replay the launch');

// 3 · A returning person opening "/" goes home without the welcome screen.
{
  const { page, context } = await open({ path: '/#/' });
  await launched(page);
  assert.match(page.url(), /#\/wallet$/);
  assert.equal(await page.evaluate(() => window.__seen.has('welcome')), false, 'the welcome screen never mounted');
  await context.close();
}
console.log('✓ a returning person never sees the welcome screen');

// 4 · A first run: the welcome screen, and the launch frame released for it.
{
  const { page, context } = await open({ path: '/#/', saved: false });
  await page.waitForSelector('.welcome-page', { timeout: 90000 });
  await page.waitForFunction(() => !document.getElementById('launch-frame'), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__seen.has('launch')), false);
  await page.screenshot({ path: `${output}/first-run-welcome.png` });
  await context.close();
}
console.log('✓ a first run gets the welcome screen, with the launch frame released');

// 5 · Slow wallets: the mark breathes, then travels when they are in.
{
  const { page, context, errors } = await open({ path: '/#/settings' });
  await page.waitForFunction(() => window.__audit?.app, null, { timeout: 90000 });
  await pause(1200);
  await page.evaluate(async () => {
    const vueUrl = performance.getEntriesByType('resource').map((e) => e.name).find((name) => /\/deps\/vue\.js/.test(name));
    const { h, render, ref } = await import(vueUrl);
    const LaunchMark = (await import('/src/components/LaunchMark.vue')).default;
    const target = document.createElement('div');
    Object.assign(target.style, { position: 'fixed', left: '20px', top: '60px', width: '30px', height: '30px' });
    document.body.appendChild(target);
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.__ready = ref(false);
    window.__landed = false;
    const draw = () => {
      const vnode = h(LaunchMark, { ready: window.__ready.value, target: () => target, onDone: () => { window.__landed = true; } });
      vnode.appContext = window.__audit.app._context;
      render(vnode, host);
    };
    draw();
    window.__setReady = () => { window.__ready.value = true; draw(); };
  });
  await page.waitForSelector('.launch--breathe', { timeout: 2000 });
  await pause(500);
  await page.screenshot({ path: `${output}/slow-breathing.png` });
  await page.evaluate(() => window.__setReady());
  await page.waitForFunction(() => window.__landed === true, null, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('✓ slow wallets: the mark breathes, then lands when they are in');

// 6 · Reduce Motion: no travel, a short fade.
{
  const { page, context } = await open({ reducedMotion: 'reduce' });
  await launched(page);
  assert.deepEqual(await page.evaluate(() => [window.__seen.has('fade'), window.__seen.has('travel')]), [true, false]);
  assert.equal(await logoVisible(page), true);
  await context.close();
}
console.log('✓ Reduce Motion: a fade instead of the travel');

await browser.close();
console.log(`Screenshots: ${output}`);
