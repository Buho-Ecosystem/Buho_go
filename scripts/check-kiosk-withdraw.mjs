// Actual shared withdrawal flow with isolated local state and scripted providers.
// External requests/WebSockets are blocked; no confirmation/send is performed.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { InvoiceLedger, LnurlServer } from './fixtures/contactChat.mjs'
import { boundedPaymentMax } from '../src/utils/paymentMax.js'
import { unquotedFeeLimitSats } from '../src/utils/payingWallets.js'

const base = process.env.KIOSK_BASE_URL || 'http://127.0.0.1:9100'
const output = process.env.KIOSK_WITHDRAW_OUTPUT || 'docs/images/kiosk-pos'
const report = process.env.KIOSK_WITHDRAW_REPORT || 'docs/reviews/kiosk-withdraw.json'
await mkdir(output, { recursive: true })
await mkdir(report.slice(0, report.lastIndexOf('/')) || '.', { recursive: true })
const ledger = new InvoiceLedger()
const lightning = new LnurlServer({ ledger, domain: 'wallet.example' })
const bitcoin = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
const cases = [], pageErrors = [], blocked = new Set()
const browser = await chromium.launch({ headless: true })
let context, page, stepName = 'startup'
const specs = [
  { id: 'register-lnbits', type: 'lnbits', name: 'Counter wallet', balance: 100000 },
  { id: 'register-spark', type: 'spark', name: 'Shop wallet', balance: 100000 },
  { id: 'register-nwc', type: 'nwc', name: 'Connected wallet', balance: 100000 },
]
const navigate = target => page.evaluate(path => document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push(path), target)
const sheet = () => page.locator('.sheet-card:visible')
const sheetState = () => page.evaluate(() => {
  let instance = document.querySelector('.sheet-card')?.__vueParentComponent
  let payment, wallet
  while (instance) {
    if (instance.type?.name === 'PaymentConfirmSheet') payment = instance.proxy
    if (instance.type?.name === 'WalletPage') wallet = instance.proxy
    instance = instance.parent
  }
  return { mode: payment?.amountMode, amount: payment?.amountInSats, fixedSats: payment?.payment?.amount?.fixedSats,
    source: wallet?.getSendingWallet()?.id, context: wallet?.paymentIntent?.context,
    max: wallet?.kioskWithdrawalMax, balance: wallet?.sendingWalletBalance,
    fee: wallet?.paymentSheetProps?.feeEstimate || null, l1: !!wallet?.isSparkL1Payment,
    feeGate: wallet?.l1Fee || null, canSubmit: payment?.canSubmit, intentAmount: wallet?.paymentIntent?.amountSats || null }
})
const measure = () => page.evaluate(() => {
  const card = document.querySelector('.sheet-card'), top = card.getBoundingClientRect(), primary = card.querySelector('.confirm-cta').getBoundingClientRect()
  return { sheetTop: Math.round(top.top), sheetBottom: Math.round(top.bottom), sheetHeight: Math.round(top.height), primaryBottom: Math.round(primary.bottom), fitsViewport: top.left >= -1 && top.right <= innerWidth + 1 && primary.bottom <= innerHeight + 1 }
})
const take = async name => {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(350) // let the shared CTA swap and pointer feedback finish
  await page.screenshot({ path: `${output}/${name}.png` })
}
async function fresh(source) {
  if (context) { assert.equal(await page.evaluate(() => window.__withdrawSends?.length || 0), 0); await context.close() }
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  context.setDefaultTimeout(15000)
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === base) return route.continue()
    if (lightning.owns(url.hostname)) {
      const result = lightning.handle(url)
      return route.fulfill({ status: result.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result.body) })
    }
    blocked.add(url.origin)
    return route.abort()
  })
  // No Vite HMR invalidation or external relay reaches these isolated fixtures.
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('buhoGO_language', 'en-US')
    localStorage.setItem('buho.theme', 'light')
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }))
  })
  page = await context.newPage()
  page.on('pageerror', error => pageErrors.push({ step: stepName, message: error.message }))
  await page.goto(`${base}/#/settings`)
  await page.waitForSelector('#q-app .q-page')
  await page.evaluate(async ({ source, specs }) => {
    const { useIdentityStore } = await import('/src/stores/identity.js')
    const { useWalletStore } = await import('/src/stores/wallet.js')
    const { useKioskMerchantStore } = await import('/src/stores/kioskMerchant.js')
    await useIdentityStore().importMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', true)
    const store = useWalletStore()
    store.wallets = specs.map(({ id, type, name }) => ({ id, type, name, metadata: type === 'nwc' ? { methods: ['pay_invoice', 'make_invoice', 'lookup_invoice', 'get_balance', 'list_transactions'] } : {} }))
    store.activeWalletId = specs.find(spec => spec.id !== source).id
    store.kioskEnabled = true
    store.kioskOwnerAccess = true
    store.kioskWalletId = source
    store.useBip177Format = true
    store.preferredFiatCurrency = 'EUR'
    store.exchangeRates = { eur: 75000, usd: 85000 }
    store.exchangeRateTimes = { eur: Date.now(), usd: Date.now() }
    store.connectionStates = Object.fromEntries(specs.map(spec => [spec.id, { connected: true }]))
    window.__withdrawSends = []
    window.__withdrawQuotes = []
    store.providers = Object.fromEntries(specs.map(spec => [spec.id, {
      isConnected: true,
      getBalance: async () => spec.balance,
      getTransactions: async () => [],
      getSparkAddress: async () => `fixture-${spec.id}`,
      getFeeReserveSats: async () => 20,
      getLightningSendFeeEstimate: async () => 0,
      getWithdrawalFeeQuote: async (amount, address, options) => {
        window.__withdrawQuotes.push({ walletId: spec.id, amount, address, wholeBalance: !!options?.wholeBalance })
        return Object.fromEntries([['slow', 300], ['medium', 400], ['fast', 500]].map(([speed, fee]) => [speed, { feeQuoteId: `fixture-${speed}-${amount}`, serviceFee: 100, networkFee: fee - 100, totalFee: fee }]))
      },
      payInvoice: async () => { window.__withdrawSends.push(spec.id); throw new Error('This review never sends.') },
      payLightningAddress: async () => { window.__withdrawSends.push(spec.id); throw new Error('This review never sends.') },
      withdrawToL1: async () => { window.__withdrawSends.push(spec.id); throw new Error('This review never sends.') },
    }]))
    for (const spec of specs) store.applyBalance(spec.id, spec.balance)
    const providerOf = async id => store.getProvider(id || store.activeWalletId)
    store.ensureWalletConnectedForTransfer = providerOf
    store.ensureSparkConnected = providerOf
    store.ensureLNBitsConnected = providerOf
    store.ensureNWCConnected = providerOf
    store.refreshWalletData = async () => {}
    store.refreshBalance = async id => { const spec = specs.find(value => value.id === id); if (spec) store.applyBalance(id, spec.balance) }
    store.loadExchangeRates = async () => {}
    store.connectAllSparkWallets = async () => {}
    const merchant = useKioskMerchantStore()
    await merchant.initialize({ currency: 'EUR', amountUnit: 'sats' })
    await merchant.completeSetup()
  }, { source, specs })
  await navigate('/kiosk-mode?view=payouts')
  await page.getByRole('button', { name: 'Withdraw now', exact: true }).waitFor()
}
async function openDestination(destination) {
  await page.getByRole('button', { name: 'Withdraw now', exact: true }).click()
  await page.locator('[data-audit=send-input]').fill(destination)
  await page.locator('[data-audit=send-continue]').click()
  await sheet().waitFor()
  await page.waitForFunction(() => !document.querySelector('.preparation-status'))
  assert.equal(await page.locator('.send-sheet:visible').count(), 0, 'destination input hands over to exactly one shared review')
  assert.match(new URL(page.url()).hash, /kiosk-mode.*payouts/)
  const state = await sheetState()
  assert.equal(state.context, 'kiosk-withdraw')
  return state
}
async function step(name, task) {
  stepName = name
  const result = await task()
  cases.push({ name, passed: true, ...result })
  console.log(`ok ${name}`)
}
try {
  await step('fixed invoice retains the register source and exact amount', async () => {
    await fresh('register-lnbits')
    const { bolt11 } = ledger.mint({ amountSats: 5000 })
    const state = await openDestination(bolt11)
    assert.equal(state.source, 'register-lnbits')
    assert.equal(state.mode, 'fixed')
    assert.equal(state.fixedSats, 5000)
    assert.equal(await sheet().locator('.amount-input').getAttribute('readonly'), '')
    assert.equal(await sheet().getByRole('button', { name: 'Max after fees', exact: true }).count(), 0)
    await take('withdraw-review')
    return { source: state.source, amountSats: state.fixedSats, amountReadonly: true, layout: await measure() }
  })
  await step('Spark Lightning address Max budgets the entire enforced fee allowance', async () => {
    await fresh('register-spark')
    await openDestination('shop@wallet.example')
    await sheet().getByRole('button', { name: 'Max after fees', exact: true }).click()
    const expected = boundedPaymentMax(100000, { walletType: 'spark', destinationType: 'lightning_address' })
    await page.waitForFunction(amount => {
      let instance = document.querySelector('.sheet-card')?.__vueParentComponent
      while (instance && instance.type?.name !== 'PaymentConfirmSheet') instance = instance.parent
      return instance?.proxy?.amountInSats === amount
    }, expected)
    const state = await sheetState()
    assert.equal(state.source, 'register-spark')
    assert.equal(state.amount, expected)
    const limit = unquotedFeeLimitSats(expected)
    assert(expected + limit <= 100000)
    assert(expected + 1 + unquotedFeeLimitSats(expected + 1) > 100000)
    assert.equal(state.fee?.sats, limit)
    assert.equal(state.fee?.isLimit, true)
    await sheet().locator('.slide-track').waitFor()
    assert.equal(await sheet().locator('.slide-track').getAttribute('aria-disabled'), 'false')
    await take('withdraw-max')
    return { source: state.source, amountSats: expected, maximumFeeSats: limit, maximumDebitSats: expected + limit, balanceSats: 100000, layout: await measure() }
  })
  for (const source of ['register-lnbits', 'register-nwc']) await step(`${source} does not invent a variable-amount full-balance Max`, async () => {
    await fresh(source)
    const state = await openDestination('shop@wallet.example')
    assert.equal(state.source, source)
    assert.equal(await sheet().getByRole('button', { name: 'Max after fees', exact: true }).count(), 0)
    await sheet().getByText('This wallet cannot guarantee a full-balance withdrawal. Leave room for fees.', { exact: true }).waitFor()
    return { source, boundedMaxAvailable: false }
  })
  await step('Spark Bitcoin keeps the shared on-chain fee panel and native quote tiers', async () => {
    await fresh('register-spark')
    const state = await openDestination(bitcoin)
    assert.equal(state.source, 'register-spark')
    assert.equal(state.l1, true)
    await sheet().locator('.amount-input').fill('10000')
    await sheet().getByRole('button', { name: /Standard/ }).waitFor()
    const panel = await sheetState()
    assert.equal(panel.feeGate?.totalFeeSats, 400)
    assert.equal(await sheet().getByRole('button', { name: 'Use all', exact: true }).count(), 1)
    assert.equal(await sheet().getByRole('button', { name: 'Max after fees', exact: true }).count(), 0)
    const quotes = await page.evaluate(() => window.__withdrawQuotes)
    assert(quotes.some(quote => quote.walletId === 'register-spark' && quote.address === bitcoin))
    return { source: panel.source, selectedFeeSats: panel.feeGate.totalFeeSats, nativeQuoteTiers: 3, layout: await measure() }
  })
  await step('Auto-Transfer Bitcoin destination keeps arrival choices without enabling a rule', async () => {
    await fresh('register-spark')
    await page.getByRole('button', { name: /Set up Auto-Transfer/ }).click()
    const auto = page.locator('.at-sheet:visible')
    await auto.waitFor()
    await auto.getByRole('button', { name: /^Destination/ }).click()
    await page.evaluate(value => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => value } }), bitcoin)
    await auto.getByRole('button', { name: 'Paste', exact: true }).click()
    await auto.getByRole('button', { name: /^Arrives/ }).click()
    const labels = ['Within an hour', 'About 30 minutes', 'Next block']
    for (const label of labels) await auto.getByRole('button', { name: label, exact: true }).waitFor()
    await take('auto-transfer-bitcoin')
    await auto.getByRole('button', { name: 'Next block', exact: true }).click()
    await auto.getByRole('button', { name: /^Arrives.*Next block/ }).waitFor()
    const ruleEnabled = await page.evaluate(async () => {
      const { useAutoWithdrawStore } = await import('/src/stores/autoWithdraw.js')
      return !!useAutoWithdrawStore().getConfig('register-spark')?.enabled
    })
    assert.equal(ruleEnabled, false)
    return { source: 'register-spark', arrivalChoices: labels, ruleEnabled }

  })
  assert.equal(await page.evaluate(() => window.__withdrawSends.length), 0)
  assert.deepEqual(pageErrors, [])
  assert(cases.filter(entry => entry.layout).every(entry => entry.layout.fitsViewport), 'shared reviews retain their primary action on the phone')
  await writeFile(report, JSON.stringify({ passed: true, cases, viewport: { width: 390, height: 844 }, externalNetworkBlocked: true, viteHmrDisabled: true, outgoingSubmissions: 0, pageErrors, blockedExternalOrigins: [...blocked].sort(), limitations: ['Providers, balance and remote address responses are scripted.', 'No confirmation/send performed; native credentials, SDK settlement and real funds remain unverified.'] }, null, 2) + '\n')
} catch (error) {
  if (page && !page.isClosed()) {
    await take('withdraw-failure')
    console.error('Failure step:', stepName, '\n', (await page.locator('body').innerText()).slice(-3500))
  }
  await writeFile(report, JSON.stringify({ passed: false, cases, failedStep: stepName, error: error.message, pageErrors }, null, 2) + '\n')
  throw error
} finally { await browser.close() }
