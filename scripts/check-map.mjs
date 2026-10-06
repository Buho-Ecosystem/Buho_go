// Run after `quasar build -m pwa`: node scripts/check-map.mjs
// Exercises the built worker, map pins, style swaps, search and zoom in a real
// browser. MAP_LIVE=1 additionally checks the public map and merchant services.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { chromium, expect } from '@playwright/test'

const root = resolve(process.env.MAP_DIST || 'dist/pwa')
const output = resolve('output/btcmap-investigation')
await readFile(resolve(root, 'index.html')) // Require a completed production build.
await mkdir(output, { recursive: true })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return }
  try {
    const file = path === root ? resolve(root, 'index.html') : path
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body)
  } catch {
    // Missing worker assets must fail, not get an SPA fallback document.
    res.writeHead(404).end()
  }
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const base = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'chromium' })
  const live = process.env.MAP_LIVE === '1'
  const mobile = process.env.MAP_MOBILE === '1'
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 850 }
  const label = `${live ? 'fixed-live' : 'fixed-fixture'}${mobile ? '-mobile' : ''}`
  const context = await browser.newContext({
    viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block',
    reducedMotion: 'reduce',
  })
  await context.addInitScript(() => {
    localStorage.setItem('buhoGO_language', 'en-US')
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }))
    window.__mapWorkers = []
    const OriginalWorker = window.Worker
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options)
        const record = { url: String(url), messages: 0, failed: false }
        window.__mapWorkers.push(record)
        this.addEventListener('message', () => { record.messages++ })
        this.addEventListener('error', () => { record.failed = true })
      }
    }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  const workerResponses = []
  const merchantResponses = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.url().includes('maplibre-gl-worker')) workerResponses.push({ url: response.url(), status: response.status() })
    if (response.url().startsWith('https://api.btcmap.org/v4/places')) merchantResponses.push(response.json())
  })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!live && url.hostname === 'api.btcmap.org') return route.fulfill({ json: [
      { id: 1, lat: 30, lon: 10, name: 'Map Test Cafe', icon: 'cafe' },
      { id: 2, lat: 0, lon: 80, name: 'Map Test Books', icon: 'books' },
    ] })
    if (!live && url.hostname === 'tiles.openfreemap.org') return route.fulfill({ json: {
      version: 8, sources: {}, glyphs: `${base}/test-glyphs/{fontstack}/{range}.pbf`,
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': url.pathname.endsWith('/dark') ? '#263238' : '#e5eef1' } }],
    } })
    if (url.pathname.startsWith('/test-glyphs/')) return route.fulfill({ body: Buffer.alloc(0) })
    if (url.hostname === 'nominatim.openstreetmap.org') return route.fulfill({ json: [] })
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue()
    if (live && ['api.btcmap.org', 'tiles.openfreemap.org', 'api.openstreetmap.org'].includes(url.hostname)) return route.continue()
    return route.abort()
  })
  await page.routeWebSocket('**', socket => socket.close())

  async function ready() {
    await expect(page.locator('.sheet-summary-count')).toContainText(/\d+ places? here/, { timeout: 45000 })
    await page.waitForFunction(() => window.__mapWorkers.some(worker => worker.messages > 0))
    assert.deepEqual(await page.evaluate(() => window.__mapWorkers.filter(worker => worker.failed)), [])
    assert.ok(workerResponses.some(response => response.status === 200), 'built map worker must be served')
    assert.ok(workerResponses.every(response => response.status === 200), 'no missing map worker')
  }

  await page.goto(`${base}/#/map`)
  await ready()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${output}/${label}.png` })
  console.log('PASS production worker starts and merchant data loads')

  if (!live) {
    // Clicking a canvas pin verifies that the worker actually produced the
    // GeoJSON features; the presence of a canvas or a populated list is not enough.
    await expect(async () => {
      await page.mouse.click(viewport.width / 2, viewport.height / 2)
      await expect(page.locator('.detail-name')).toHaveText('Map Test Cafe', { timeout: 1000 })
    }).toPass({ timeout: 15000 })
    await page.getByRole('button', { name: 'Save place', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove from saved' })).toBeVisible()
    console.log('PASS rendered merchant pin opens its detail and can be saved')

    await page.reload()
    await ready()
  }

  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Close filters' }).click()
  if (!live) {
    await expect(async () => {
      await page.mouse.click(viewport.width / 2, viewport.height / 2)
      await expect(page.locator('.detail-name')).toHaveText('Map Test Cafe', { timeout: 1000 })
    }).toPass({ timeout: 15000 })
    console.log('PASS merchant pins remain interactive after a basemap style swap')
  }

  const merchant = live ? 'Green Town' : 'Map Test Books'
  await page.getByRole('button', { name: 'Find a place', exact: true }).click()
  await page.locator('.search-input').fill(merchant)
  await page.locator('.search-results .place-row').filter({ hasText: merchant }).first().click()
  await expect(page.locator('.detail-name')).toHaveText(merchant)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await page.waitForTimeout(1200)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: `${output}/${label}-detail.png` })
  console.log('PASS merchant search, detail navigation and zoom controls')
  if (live) {
    // The global directory can exceed sessionStorage's quota; caching is
    // best-effort, so inspect the actual response rather than relying on it.
    const [merchants] = await Promise.all(merchantResponses)
    console.log(`Live BTCMap records: ${merchants?.length}`)
    assert.ok(merchants?.length > 1000)
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
