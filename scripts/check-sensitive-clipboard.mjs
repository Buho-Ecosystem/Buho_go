/**
 * Exercise the real browser clipboard with dummy text only, in isolated contexts.
 * Run: node scripts/check-sensitive-clipboard.mjs
 * Requires Playwright Chromium and WebKit. No wallet, real key or clipboard read.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';

const root = new URL('../', import.meta.url);
const files = {
  '/clipboard.js': 'src/utils/sensitiveClipboard.js',
  '/crypto.js': 'src/utils/deviceCrypto.js',
  '/capacitor.js': 'node_modules/@capacitor/core/dist/index.js',
};
const html = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"@capacitor/core":"/capacitor.js"}}</script>
<button id="text">Copy text</button><button id="secret">Copy derived text</button>
<button id="delayed">Copy after slow unlock</button><button id="late">Late request control</button>
<script type="module">
import { copySensitive, cancelPendingSensitiveClear } from '/clipboard.js';
import { encryptString, decryptString } from '/crypto.js';
const encrypted = await encryptString('BuhoGO clipboard test — dummy text');
const slowSecret = async () => {
  await new Promise(resolve => setTimeout(resolve, 6000));
  return decryptString(encrypted);
};
const actions = {
  text: () => copySensitive('BuhoGO clipboard test — dummy text'),
  secret: () => copySensitive(() => decryptString(encrypted)),
  delayed: () => copySensitive(slowSecret),
  late: async () => navigator.clipboard.writeText(await slowSecret()),
};
window.results = {};
for (const [id, action] of Object.entries(actions)) {
  document.getElementById(id).onclick = async () => {
    try { await action(); window.results[id] = 'copied'; }
    catch (error) { window.results[id] = error.name; }
    finally { cancelPendingSensitiveClear(); }
  };
}
window.ready = true;
</script>`;
const server = createServer(async (request, response) => {
  try {
    const file = files[request.url];
    response.setHeader('Content-Type', file ? 'text/javascript' : 'text/html');
    response.end(file ? await readFile(new URL(file, root), 'utf8') : html);
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext();
      // Chromium's automated context requires an explicit grant. The unit
      // regression separately enforces synchronous user-gesture registration.
      if (name === 'chromium') await context.grantPermissions(['clipboard-write'], { origin });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.name));
      await page.goto(origin);
      await page.waitForFunction(() => window.ready);
      for (const id of ['text', 'secret', 'delayed']) {
        await page.click(`#${id}`);
        await page.waitForFunction(id => window.results[id], id);
        assert.equal(await page.evaluate(id => window.results[id], id), 'copied', `${name}: ${id}`);
      }
      if (name === 'webkit') {
        await page.click('#late');
        await page.waitForFunction(() => window.results.late);
        assert.equal(await page.evaluate(() => window.results.late), 'NotAllowedError', 'WebKit must reject a write started after activation expires');
      }
      assert.deepEqual(errors, []);
      console.log(`${name}: immediate and asynchronous copies passed, including slow unlock`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
