/**
 * Backup preparation fit check. Start `npx quasar dev --port 9014` first.
 *
 * Opens the real recovery dialog on the Security page and checks that the
 * preparation step (intro, notices, "I understand", Next) fits one screen
 * without scrolling on common phone sizes, in English, German and Spanish,
 * with and without the unlock sentence, and with Android system bars (a
 * 32 px status bar and a 48 px 3-button navigation bar) as well as without.
 * No wallet or phrase is loaded.
 * Screenshots land in BACKUP_FIT_OUTPUT (default output/backup-fit).
 *
 *   node scripts/check-backup-fit.mjs
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.BACKUP_FIT_BASE_URL || 'http://localhost:9014';
const output = process.env.BACKUP_FIT_OUTPUT || 'output/backup-fit';
await mkdir(output, { recursive: true });

// Portrait phones from the smallest still in use to large Android screens.
const PHONES = [[320, 568], [360, 640], [375, 667], [360, 740], [390, 844], [393, 852], [412, 915]];
const LOCALES = ['en-US', 'de', 'es'];

const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const locale of LOCALES) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base || ['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
      return route.abort();
    });
    await page.addInitScript(language => {
      window.__AUDIT__ = { theme: 'dark', noExitMonitor: true };
      localStorage.setItem('buhoGO_language', language);
      localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
    }, locale);
    await page.goto(`${base}/#/security`);
    await page.locator('.security-page').waitFor();
    await page.evaluate(() => {
      let component = document.querySelector('.security-page').__vueParentComponent;
      while (component && component.type.name !== 'SecurityPage') component = component.parent;
      component.proxy.selection = { kind: 'wallet', walletId: null, mode: 'backup' };
      component.proxy.showWords = true;
    });
    await page.locator('.recovery-body--prepare').waitFor();

    for (const [unlock, bars] of [[false, false], [true, false], [false, true], [true, true]]) {
      await page.evaluate(async ({ on, bars }) => {
        const { useWalletStore } = await import('/src/stores/wallet.js');
        useWalletStore().biometricsEnabled = on;
        window.__audit.injectSafeAreaBands(bars ? { top: 32, bottom: 48 } : { top: 0, bottom: 0 });
      }, { on: unlock, bars });
      for (const [width, height] of PHONES) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(120);
        const fit = await page.evaluate(bottomBar => {
          const body = document.querySelector('.recovery-body--prepare');
          const next = document.querySelector('.recovery-primary').getBoundingClientRect();
          const art = document.querySelector('.recovery-illustration').getBoundingClientRect();
          const artShown = getComputedStyle(document.querySelector('.recovery-illustration')).display !== 'none';
          return {
            overflow: body.scrollHeight - body.clientHeight,
            nextBottom: next.bottom,
            viewport: window.innerHeight - bottomBar,
            intro: getComputedStyle(document.querySelector('.recovery-intro')).fontSize,
            text: getComputedStyle(document.querySelector('.recovery-notice p')).fontSize,
            weight: getComputedStyle(document.querySelector('.recovery-intro')).fontWeight,
            art: artShown ? Math.round(art.height) : 0,
            tinyArt: artShown && art.height < 40,
          };
        }, bars ? 48 : 0);
        const label = `${locale} ${width}x${height}${unlock ? ' +unlock' : ''}${bars ? ' +bars' : ''}`;
        if (fit.overflow > 1 || fit.nextBottom > fit.viewport + 0.5 || Number(fit.weight) < 700 || fit.tinyArt) failures.push({ label, ...fit });
        console.log(`${label.padEnd(32)} overflow ${String(fit.overflow).padStart(3)}px  headline ${fit.intro} (${fit.weight})  text ${fit.text}  illustration ${fit.art ? `${fit.art}px` : 'hidden'}`);
        if ((width === 320 || width === 360 && height === 640) && unlock && (bars || locale === 'en-US')) {
          await page.screenshot({ path: `${output}/${locale}-${width}x${height}-unlock${bars ? '-bars' : ''}.png` });
        }
      }
    }
    assert.deepEqual(errors, [], `${locale}: page errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, [], 'every phone size shows the whole step without scrolling');
console.log('PASS: backup preparation fits one screen on every phone size, in English, German and Spanish, with and without the unlock sentence and Android system bars; Next stays above the navigation bar and the headline stays bold.');
