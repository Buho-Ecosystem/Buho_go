/**
 * Bitcoin Card payments at the register, end to end in the real app.
 *
 * Start `npx quasar dev --port 9100`, then run `node scripts/check-kiosk-nfc.mjs`.
 * A card's link enters through offerKioskPayment, where the phone's NFC
 * reader hands it over once it has read the tag (src/boot/nfc.js runs only
 * on a phone). The card's service and the receiving wallet are scripted: no
 * card, payment or remote service is involved.
 *
 * - On the pay screen, under the PIN limit, the tap pays without a PIN.
 * - At the limit the PIN is asked in place, with the amount; Pay another way
 *   sends nothing to the card, and a wrong PIN can be retried.
 * - A card held before the sale waits for Charge card, even when no PIN is needed.
 * - A card blocked by wrong PINs keeps the sale, and its QR still pays.
 * - Every call to the card carries the sale's own payment request, made once.
 * - A sale is paid only once the wallet sees the payment, not when the card's
 *   service accepts, and is recorded as paid by card.
 * - The owner area stays locked.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { InvoiceLedger } from './fixtures/contactChat.mjs'

const base = process.env.KIOSK_BASE_URL || 'http://127.0.0.1:9100'
const output = process.env.KIOSK_OUTPUT || 'output/kiosk-nfc'
/** What the card carries: its service's address with the card's own authentication (`p`, `c`). */
const CARD_LINK = 'lnurlw://card.example/tap?p=4E2F9A1C0B7D3E5F&c=8A1B2C3D4E5F6071'
const CARD_PIN = '1234'
/** The card's limit (LUD-XX, millisatoshis): sales of 50 sats and more need the PIN. */
const PIN_LIMIT_MSAT = 50_000

await mkdir(output, { recursive: true })
const ledger = new InvoiceLedger()
/** What the register sent the card's service: `{ request, pin }` per try. */
const cardCalls = []
const errors = []
let invoicesMade = 0

/**
 * The card's service (LUD-03 with LUD-XX). Like a real one it checks the
 * card, gives every tap its own challenge and accepts each only once, wants
 * the PIN from its limit on, blocks the card after three wrong PINs, and
 * answers at once but pays afterwards.
 */
function cardService() {
  const challenges = new Set()
  let taps = 0
  let wrongPins = 0
  let blocked = false
  return route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/tap') {
      assert.equal(url.searchParams.get('p'), '4E2F9A1C0B7D3E5F', 'the card authenticates itself')
      assert.equal(url.searchParams.get('c'), '8A1B2C3D4E5F6071')
      const k1 = `challenge-${++taps}`
      challenges.add(k1)
      return route.fulfill({
        json: {
          tag: 'withdrawRequest',
          k1,
          callback: 'https://card.example/callback',
          minWithdrawable: 1_000,
          maxWithdrawable: 1_000_000,
          defaultDescription: 'Bitcoin Card',
          pinLimit: PIN_LIMIT_MSAT,
        },
      })
    }
    assert.equal(url.pathname, '/callback')
    const k1 = url.searchParams.get('k1')
    assert.ok(challenges.has(k1), 'a challenge from a tap that is still open')
    const call = { request: url.searchParams.get('pr'), pin: url.searchParams.get('pin') }
    cardCalls.push(call)
    const sale = ledger.byInvoice(call.request)
    assert.ok(sale, 'the card is handed a payment request the wallet made')
    const answer = reason => route.fulfill({ json: { status: 'ERROR', reason } })
    if (blocked) return answer('Card blocked: too many incorrect PIN attempts')
    const pinNeeded = sale.amountSats * 1_000 >= PIN_LIMIT_MSAT
    if (pinNeeded ? call.pin !== CARD_PIN : call.pin !== null) {
      blocked = ++wrongPins >= 3
      return answer(blocked ? 'Card blocked: too many incorrect PIN attempts' : 'Invalid PIN')
    }
    wrongPins = 0
    challenges.delete(k1)
    return route.fulfill({ json: { status: 'OK' } })
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
const card = cardService()
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin === base) return route.continue()
  return url.hostname === 'card.example' ? card(route) : route.abort()
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
const text = locator => locator.innerText().then(value => value.replace(/\s+/g, ' ').trim())
const typeAmount = async digits => {
  for (const digit of digits) await page.locator('.amount-keypad__key').filter({ hasText: new RegExp(`^${digit}$`) }).click()
}
const typePin = async digits => {
  for (const digit of digits) await page.locator('.card-pin-key').filter({ hasText: new RegExp(`^${digit}$`) }).click()
}
/** Waits until the card's service has been called `count` times in all. */
async function cardCalled(count) {
  const deadline = Date.now() + 10_000
  while (cardCalls.length < count) {
    assert.ok(Date.now() < deadline, `the card's service is called (${cardCalls.length} of ${count})`)
    await page.waitForTimeout(50)
  }
}
const currentSale = () =>
  page.evaluate(async () => {
    const { useKioskMerchantStore } = await import('/src/stores/kioskMerchant.js')
    const order = useKioskMerchantStore().currentOrder
    return { request: order?.attempts.at(-1)?.paymentRequest, method: order?.method || null }
  })

/** Starts a sale of `digits` sats; returns where its calls to the card begin. */
async function charge(digits) {
  const firstCall = cardCalls.length
  await typeAmount(digits)
  await page.locator('.pos-charge-btn').click()
  return firstCall
}

/**
 * The sale's payment reaches the wallet and the register shows it as paid,
 * not before. Every call to the card since the sale began carried its request.
 */
async function settles(firstCall, { method, name }) {
  const { request } = await currentSale()
  assert.ok(cardCalls.slice(firstCall).every(call => call.request === request), "every call carried this sale's request")
  await page.waitForTimeout(1_000)
  assert.equal(await page.locator('.kiosk-paid').count(), 0, 'paid only once the wallet sees the payment')
  ledger.pay(request)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.locator('.kiosk-paid').waitFor()
  assert.equal((await currentSale()).method, method)
  await snapshot(name)
  await page.getByRole('button', { name: 'New charge', exact: true }).click()
  await page.locator('.amount-keypad').waitFor()
}

try {
  // A register in Bitcoin, its wallet scripted above.
  await page.goto(`${base}/#/settings`)
  await page.waitForFunction(() => window.__audit?.app)
  await page.evaluate(async cardLink => {
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
    window.__tapCard = () => offerKioskPayment(cardLink, store, router)
  }, CARD_LINK)
  await page.locator('.kiosk-page').waitFor()
  await page.waitForFunction(() => !document.querySelector('.pos-connection'))

  // 1. On the pay screen, under the PIN limit: the tap pays.
  let sale = await charge('40')
  await page.locator('.pos-qr-img').waitFor()
  await snapshot('01-pay-screen')
  await tapCard()
  await page.getByText('Paying…').waitFor()
  await cardCalled(1)
  assert.equal(await page.locator('.card-pin-pad').count(), 0, 'no PIN under the limit')
  assert.equal(cardCalls.at(-1).pin, null)
  await settles(sale, { method: 'card', name: '02-paid-without-pin' })

  // 2. At the limit: the PIN in place with the amount; Pay another way sends nothing; a wrong PIN is retried.
  sale = await charge('50')
  await page.locator('.pos-qr-img').waitFor()
  await tapCard()
  await page.locator('.card-pin-pad').waitFor()
  assert.equal(await text(page.locator('.card-pin-sats')), '₿ 50', 'the customer sees what the PIN pays')
  await snapshot('03-pin')
  await page.getByRole('button', { name: 'Pay another way', exact: true }).click()
  await page.locator('.pos-qr-img').waitFor()
  assert.equal(cardCalls.length, sale, 'nothing goes to the card without its PIN')
  await tapCard()
  await page.locator('.card-pin-pad').waitFor()
  await typePin('0000')
  await page.getByText('Wrong PIN. 2 tries left.', { exact: true }).waitFor()
  await snapshot('04-wrong-pin')
  await typePin(CARD_PIN)
  await cardCalled(sale + 2)
  await page.getByText('Paying…').waitFor()
  await settles(sale, { method: 'card', name: '05-paid-with-pin' })

  // 3. Held before the sale: the register waits for Charge card, even with no PIN to ask.
  await tapCard()
  await page.getByText('Card held · enter the amount', { exact: true }).waitFor()
  await snapshot('06-card-held')
  sale = await charge('40')
  const chargeCard = page.getByRole('button', { name: 'Charge card', exact: true })
  await chargeCard.waitFor()
  await snapshot('07-charge-card')
  await page.waitForTimeout(500)
  assert.equal(cardCalls.length, sale, 'a held card pays only after Charge card')
  await chargeCard.click()
  await cardCalled(sale + 1)
  await settles(sale, { method: 'card', name: '08-paid-held-card' })

  // 4. Three wrong PINs block the card: the sale is kept, and its QR still pays.
  sale = await charge('50')
  await page.locator('.pos-qr-img').waitFor()
  await tapCard()
  for (const [tries, message] of [[1, 'Wrong PIN. 2 tries left.'], [2, 'Wrong PIN. 1 try left.']]) {
    await page.locator('.card-pin-pad').waitFor()
    await typePin('0000')
    await cardCalled(sale + tries)
    await page.getByText(message, { exact: true }).waitFor()
  }
  await typePin('0000')
  await page.getByText('Card locked after too many wrong PINs.', { exact: true }).waitFor()
  await page.locator('.pos-qr-img').waitFor()
  await snapshot('09-card-locked')
  assert.equal(cardCalls.length, sale + 3)
  // Paid by QR after the card failed on the same request: how it was paid is not known, so none is recorded.
  await settles(sale, { method: null, name: '10-paid-by-qr-after-locked-card' })

  assert.equal(invoicesMade, 4, 'one payment request per sale')
  const ownerAccess = await page.evaluate(() => window.__audit.app.config.globalProperties.$pinia._s.get('wallet').kioskOwnerAccess)
  assert.equal(ownerAccess, false, 'a card never opens the owner area')
  assert.deepEqual(errors, [])
  console.log('Kiosk Bitcoin Card: pay on tap, PIN at the limit, Pay another way, wrong PIN, held card, locked card keeps the sale, paid when the wallet sees it')
} catch (error) {
  await snapshot('failure').catch(() => {})
  throw error
} finally {
  await browser.close()
}
