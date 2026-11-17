/**
 * Bitcoin Card payments at the register, end to end in the real app.
 *
 * Start `npx quasar dev --port 9100`, then run `node scripts/check-kiosk-nfc.mjs`.
 * A tap enters where the phone's NFC reader hands a card over
 * (offerKioskPayment). The card's service and the receiving wallet are
 * scripted: no card, payment or remote service is involved.
 *
 * - A card on the pay screen under its PIN limit pays without a PIN.
 * - Above the limit the customer types the PIN in place; a wrong PIN can be retried.
 * - A card held before the sale waits for Charge card.
 * - Each sale hands the card its own payment request, made once.
 * - A sale is paid only once the wallet sees the payment, not when the card's service says yes.
 * - The owner area stays locked throughout.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { InvoiceLedger } from './fixtures/contactChat.mjs'

const base = process.env.KIOSK_BASE_URL || 'http://127.0.0.1:9100'
const output = process.env.KIOSK_OUTPUT || 'output/kiosk-nfc'
const CARD_PIN = '1234'
/** The card's limit (LUD-XX, millisatoshis): sales of 50 sats and more need the PIN. */
const PIN_LIMIT_MSAT = 50_000

await mkdir(output, { recursive: true })
const ledger = new InvoiceLedger()
/** What the register sent the card's service: `{ request, pin }` per try. */
const cardCalls = []
const errors = []
let invoicesMade = 0

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })

// The card's service (LUD-03). Like a real one it answers at once and pays
// afterwards, and wants the PIN only from its limit on.
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin === base) return route.continue()
  if (url.hostname !== 'card.example') return route.abort()
  if (url.pathname === '/tap') {
    return route.fulfill({
      json: {
        tag: 'withdrawRequest',
        k1: 'card-challenge',
        callback: 'https://card.example/callback',
        minWithdrawable: 1_000,
        maxWithdrawable: 1_000_000,
        defaultDescription: 'Bitcoin Card',
        pinLimit: PIN_LIMIT_MSAT,
      },
    })
  }
  assert.equal(url.pathname, '/callback')
  assert.equal(url.searchParams.get('k1'), 'card-challenge')
  const call = { request: url.searchParams.get('pr'), pin: url.searchParams.get('pin') }
  cardCalls.push(call)
  const sale = ledger.byInvoice(call.request)
  assert.ok(sale, 'the card is handed a payment request the wallet made')
  const pinNeeded = sale.amountSats * 1_000 >= PIN_LIMIT_MSAT
  const accepted = pinNeeded ? call.pin === CARD_PIN : call.pin === null
  return route.fulfill({ json: accepted ? { status: 'OK' } : { status: 'ERROR', reason: 'Invalid PIN' } })
})
await context.routeWebSocket('**/*', socket => socket.close())

// The receiving wallet.
await context.exposeFunction('__kioskCreate', amountSats => {
  invoicesMade += 1
  const invoice = ledger.mint({ amountSats })
  return { paymentRequest: invoice.bolt11, paymentHash: invoice.paymentHash, expiresAt: Math.floor(Date.now() / 1000) + 3600 }
})
await context.exposeFunction('__kioskLookup', paymentHash => {
  const invoice = ledger._byHash.get(paymentHash)
  return { paid: invoice?.paid === true, paymentHash, amount: invoice?.amountSats, transactionId: `tx-${paymentHash}` }
})
await context.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true }
  localStorage.setItem('buhoGO_language', 'en-US')
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null }))
})

const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))

const snapshot = name => page.screenshot({ path: `${output}/${name}.png` })
const tapCard = () => page.evaluate(() => window.__tapCard())
const typeAmount = async digits => {
  for (const digit of digits) await page.locator('.amount-keypad__key').filter({ hasText: new RegExp(`^${digit}$`) }).click()
}
const typePin = async digits => {
  for (const digit of digits) await page.locator('.card-pin-key').filter({ hasText: new RegExp(`^${digit}$`) }).click()
}
const charge = async digits => {
  await typeAmount(digits)
  await page.locator('.pos-charge-btn').click()
}
const salePaymentRequest = () =>
  page.evaluate(async () => {
    const { useKioskMerchantStore } = await import('/src/stores/kioskMerchant.js')
    return useKioskMerchantStore().currentOrder.attempts.at(-1).paymentRequest
  })

/**
 * The card's service said yes: the register keeps waiting until the payment
 * reaches the wallet, then shows the sale as paid.
 */
async function settles(name) {
  await page.getByText('Paying…').waitFor()
  await page.waitForTimeout(1_000)
  assert.equal(await page.locator('.kiosk-paid').count(), 0, 'paid only once the wallet sees the payment')
  const request = await salePaymentRequest()
  assert.equal(cardCalls.at(-1).request, request, 'the card paid this sale')
  ledger.pay(request)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.locator('.kiosk-paid').waitFor()
  await snapshot(name)
  await page.getByRole('button', { name: 'New charge', exact: true }).click()
  await page.locator('.amount-keypad').waitFor()
}

try {
  // A register in Bitcoin, its wallet scripted above.
  await page.goto(`${base}/#/settings`)
  await page.waitForFunction(() => window.__audit?.app)
  await page.evaluate(async () => {
    const { app } = window.__audit
    const store = app.config.globalProperties.$pinia._s.get('wallet')
    const provider = {
      isConnected: true,
      createInvoice: ({ amount }) => window.__kioskCreate(amount),
      lookupInvoice: hash => window.__kioskLookup(hash),
      getBalance: async () => 100_000,
      getTransactions: async () => [],
    }
    Object.assign(store, {
      initialize: async () => {},
      isInitialized: true,
      wallets: [{ id: 'register', type: 'lnbits', name: 'Shop register' }],
      providers: { register: provider },
      kioskWalletId: 'register',
      kioskEnabled: true,
      kioskOwnerAccess: false,
      kioskTipEnabled: false,
      kioskRoundUpEnabled: false,
      kioskDisplayCurrency: 'sats',
      ensureWalletConnectedForTransfer: async () => provider,
      createInvoiceDetailsOnWallet: (_walletId, amountSats) => window.__kioskCreate(amountSats),
      lookupInvoiceOnWallet: (_walletId, hash) => window.__kioskLookup(hash),
      refreshBalance: async () => {},
      refreshWalletData: async () => {},
    })
    const router = app.config.globalProperties.$router
    await router.push('/kiosk')
    const { offerKioskPayment } = await import('/src/services/kioskPaymentIntake.js')
    window.__tapCard = () => offerKioskPayment('lnurlw://card.example/tap', store, router)
  })
  await page.locator('.kiosk-page').waitFor()
  await page.waitForFunction(() => !document.querySelector('.pos-connection'))

  // 1. On the pay screen, under the PIN limit: the tap pays.
  await charge('40')
  await page.locator('.pos-qr-img').waitFor()
  await snapshot('01-pay-screen')
  await tapCard()
  await page.getByText('Paying…').waitFor()
  assert.equal(await page.locator('.card-pin-pad').count(), 0, 'no PIN under the limit')
  assert.equal(cardCalls.at(-1).pin, null)
  await settles('02-paid-without-pin')

  // 2. On the pay screen, above the limit: the PIN in place, a wrong one retried.
  await charge('100')
  await page.locator('.pos-qr-img').waitFor()
  await tapCard()
  await page.locator('.card-pin-pad').waitFor()
  await snapshot('03-pin')
  await typePin('0000')
  await page.getByText('Wrong PIN. 2 tries left.', { exact: true }).waitFor()
  await snapshot('04-wrong-pin')
  await typePin(CARD_PIN)
  await settles('05-paid-with-pin')

  // 3. Held before the sale: the register says so and waits for Charge card.
  await tapCard()
  await page.getByText('Card held · enter the amount', { exact: true }).waitFor()
  await snapshot('06-card-held')
  await charge('100')
  const chargeCard = page.getByRole('button', { name: 'Charge card', exact: true })
  await chargeCard.waitFor()
  await snapshot('07-charge-card')
  assert.equal(cardCalls.length, 3, 'a held card pays only after Charge card')
  await chargeCard.click()
  await page.locator('.card-pin-pad').waitFor()
  await typePin(CARD_PIN)
  await settles('08-paid-held-card')

  assert.equal(invoicesMade, 3, 'one payment request per sale')
  assert.equal(new Set(cardCalls.map(call => call.request)).size, 3, 'each sale handed the card its own request')
  assert.deepEqual(cardCalls.map(call => call.pin), [null, '0000', CARD_PIN, CARD_PIN])
  const ownerAccess = await page.evaluate(() => window.__audit.app.config.globalProperties.$pinia._s.get('wallet').kioskOwnerAccess)
  assert.equal(ownerAccess, false, 'a card never opens the owner area')
  assert.deepEqual(errors, [])
  console.log('Kiosk Bitcoin Card: pay screen with and without PIN, wrong PIN retried, held card, settlement by the wallet passed')
} catch (error) {
  await snapshot('failure').catch(() => {})
  throw error
} finally {
  await browser.close()
}
