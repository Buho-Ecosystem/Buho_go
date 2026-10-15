// Native shared-request review with four isolated app instances. Real chat crypto,
// LNURL and NWC payment services; simulated relays/wallets, no production funds.
// Start the app on port 9017, then run npm run check:shared-requests.
import { chromium } from '@playwright/test'
import { finalizeEvent, getPublicKey, nip04 } from 'nostr-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { deriveNostrIdentity } from '../src/utils/identityCrypto.js'
import {
  InvoiceLedger,
  LnurlServer,
  SimRelay
} from './fixtures/contactChat.mjs'

const base = process.env.SHARED_REQUESTS_BASE_URL || 'http://localhost:9017'
const output = process.env.SHARED_REQUESTS_OUTPUT || 'output/shared-requests'
await mkdir(output, { recursive: true })

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

const person = (name, mnemonic) => {
  const keys = deriveNostrIdentity(mnemonic)
  return {
    name,
    mnemonic,
    secretKey: keys.privateKey,
    pubkey: keys.publicKeyHex,
    npub: keys.npub
  }
}
const ALICE = person(
  'Alice',
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
)
const BOB = person(
  'Bob',
  'legal winner thank year wave sausage worth useful legal winner thank yellow'
)
const CAROL = person(
  'Carol',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'
)
const DAVE = person('Dave', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')

/** A signed kind 0, the way the address book stores a Nostr contact. */
const profileOf = (who) =>
  finalizeEvent(
    {
      kind: 0,
      created_at: 1790000000,
      tags: [],
      content: JSON.stringify({ name: who.name })
    },
    who.secretKey
  )

const relay = new SimRelay()
const ledger = new InvoiceLedger()
const NWC_SERVER_KEY = Uint8Array.from({ length: 32 }, () => 40)
const NWC_SERVER_PUBKEY = getPublicKey(NWC_SERVER_KEY)
const NWC_URL = `nostr+walletconnect://${NWC_SERVER_PUBKEY}?relay=${encodeURIComponent('wss://nwc-test.example')}&secret=${'14'.repeat(32)}`
const nwcPayments = []
relay.inject(
  finalizeEvent(
    {
      kind: 13194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['encryption', 'nip04']],
      content: 'pay_invoice get_info get_balance'
    },
    NWC_SERVER_KEY
  )
)
async function answerNwc(event) {
  const request = JSON.parse(
    await nip04.decrypt(NWC_SERVER_KEY, event.pubkey, event.content)
  )
  let result
  if (request.method === 'get_info')
    result = {
      alias: 'Test NWC wallet',
      color: '#000000',
      pubkey: NWC_SERVER_PUBKEY,
      network: 'mainnet',
      block_height: 900000,
      block_hash: '0'.repeat(64),
      methods: ['pay_invoice', 'get_info', 'get_balance']
    }
  else if (request.method === 'get_balance') result = { balance: 40000000 }
  else if (request.method === 'pay_invoice') {
    nwcPayments.push(request.params.invoice)
    result = { preimage: ledger.pay(request.params.invoice), fees_paid: 0 }
  } else throw new Error('Unexpected NWC method ' + request.method)
  const content = await nip04.encrypt(
    NWC_SERVER_KEY,
    event.pubkey,
    JSON.stringify({ result_type: request.method, result })
  )
  relay.inject(
    finalizeEvent(
      {
        kind: 23195,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['p', event.pubkey],
          ['e', event.id]
        ],
        content
      },
      NWC_SERVER_KEY
    )
  )
}
const ALICE_ADDRESS = 'alice@btc.mybuho.de'
const lnurl = new LnurlServer({
  ledger,
  domain: 'btc.mybuho.de',
  receivingWalletId: 'alice-spark'
})
const lnurlNew = new LnurlServer({
  ledger,
  domain: 'wallet.example',
  receivingWalletId: 'alice-lnbits'
})
// An address whose wallet is not in Alice's app: only LUD-21 can tell her the money arrived.
const lnurlExternal = new LnurlServer({ ledger, domain: 'getalby.example' })
const lnurlServers = [lnurl, lnurlNew, lnurlExternal]

// Wallets, described once and built inside the page (see `seedWallets`).
const ALICE_WALLETS = [
  { id: 'alice-spark', type: 'spark', name: 'Business', balance: 5000 },
  { id: 'alice-lnbits', type: 'lnbits', name: 'Shop', balance: 0 },
  { id: 'alice-nwc', type: 'nwc', name: 'Alby Hub', balance: 0 }
]
const BOB_WALLETS = [
  { id: 'bob-spark', type: 'spark', name: 'Personal', balance: 50000 },
  { id: 'bob-nwc', type: 'nwc', name: 'Alby Hub', balance: 40000 },
  { id: 'bob-lnbits', type: 'lnbits', name: 'Shop', balance: 30000 }
]

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const actors = {}
const pageErrors = []
let currentStep = 'startup'
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

async function saveFailureShots() {
  for (const [name, actor] of Object.entries(actors)) {
    await actor.page
      .screenshot({ path: `${output}/FAIL-${slug(currentStep)}-${name}.png` })
      .catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Browser setup
// ---------------------------------------------------------------------------

async function launchUser(browser, who) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  })
  context.setDefaultTimeout(15000)

  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') {
      return route.fulfill({
        contentType: 'application/json',
        body: '{"USD":85000,"EUR":78000}'
      })
    }
    if (url.origin === base || url.hostname === 'api.iconify.design')
      return route.continue()
    const server = lnurlServers.find((candidate) =>
      candidate.owns(url.hostname)
    )
    if (server) {
      const { status, body } = server.handle(url)
      return route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body)
      })
    }
    return route.abort()
  })
  await context.routeWebSocket(/.*/, (socket) => {
    if (new URL(socket.url()).host === new URL(base).host)
      return socket.connectToServer()
    const connection = relay.attach(socket.url(), (frame) => {
      try {
        socket.send(JSON.stringify(frame))
      } catch {
        /* closed */
      }
    })
    socket.onMessage((raw) => {
      connection.onMessage(String(raw))
      const frame = JSON.parse(String(raw))
      if (
        frame[0] === 'EVENT' &&
        frame[1]?.kind === 23194 &&
        frame[1].tags.some(
          (tag) => tag[0] === 'p' && tag[1] === NWC_SERVER_PUBKEY
        )
      )
        void answerNwc(frame[1])
    })
    socket.onClose(() => connection.onClose())
  })

  // The wallets' network edge: what the stubbed providers call (see `seedWallets`).
  // A Spark wallet paying a Lightning address resolves and pays it itself: here the LNURL server mints, the ledger pays.
  await context.exposeFunction(
    '__e2ePayAddress',
    (address, amountSats, comment) => {
      const [name, domain] = address.split('@')
      const server = lnurlServers.find((candidate) => candidate.owns(domain))
      const { bolt11 } = server.issue({
        name,
        amountSats,
        comment: comment || null
      })
      return { bolt11, preimage: ledger.pay(bolt11) }
    }
  )
  // What a wallet's history shows: the paid invoices of the address that wallet receives.
  await context.exposeFunction('__e2eIncoming', (walletId) =>
    lnurlServers.flatMap((server) => server.incomingFor(walletId))
  )
  await context.exposeFunction('__e2ePayInvoice', (bolt11) =>
    ledger.pay(bolt11)
  )

  await context.addInitScript(() => {
    localStorage.setItem('buhoGO_language', 'en-US')
    localStorage.setItem('buho.theme', 'light')
    localStorage.setItem(
      'buhoGO_wallet_store',
      JSON.stringify({
        wallets: [],
        activeWalletId: null,
        biometricsEnabled: false
      })
    )
  })

  const page = await context.newPage()
  page.on('pageerror', (error) =>
    pageErrors.push(
      `${who.name} during "${currentStep}": ${error.message}\n${String(error.stack).split('\n').slice(1, 4).join('\n')}`
    )
  )
  return { who, context, page }
}

/** Identity, address-book contacts and wallets, written through the app's own stores. */
async function seedUser(actor, { contacts, wallets, profileAddress = null }) {
  const { page, who } = actor
  await page.goto(`${base}/#/address-book`)
  await page.locator('.add-contact-btn').waitFor()
  await page.evaluate(
    async ({ mnemonic, contactData, address }) => {
      const { useIdentityStore } = await import('/src/stores/identity.js')
      const { useAddressBookStore } = await import('/src/stores/addressBook.js')
      await useIdentityStore().importMnemonic(mnemonic, true)
      const book = useAddressBookStore()
      await book.initialize()
      for (const contact of contactData)
        await book.addNostrContact({
          ...contact,
          allowWithoutLightningAddress: true
        })
      if (address) {
        // As the profile editor does: the address is set and published, so a
        // payer who reads the current profile (docs 8a) finds it too.
        const { useProfileStore } = await import('/src/stores/profile.js')
        const profile = useProfileStore()
        profile.setField('lud16', address)
        await profile.publish()
      }
    },
    {
      address: profileAddress,
      mnemonic: who.mnemonic,
      contactData: contacts.map((c) => ({
        pubkey: c.pubkey,
        npub: c.npub,
        event: profileOf(c)
      }))
    }
  )
  await page.evaluate((url) => {
    window.__e2eNwcUrl = url
  }, NWC_URL)
  await seedWallets(actor, wallets)
}

/**
 * Scripted wallets at the store level: connected providers that can pay an invoice or an address
 * and list what came in. `payInvoice` marks the ledger so the receiver's history shows it paid.
 */
async function seedWallets({ page }, wallets) {
  await page.evaluate(async (specs) => {
    const { useWalletStore } = await import('/src/stores/wallet.js')
    const store = useWalletStore()
    const makeProvider = (spec) => ({
      isConnected: true,
      getBalance: async () => spec.balance,
      getTransactions: async () => window.__e2eIncoming(spec.id),
      getSparkAddress: async () => `${spec.id}-spark-address`,
      getLightningSendFeeEstimate: async () => 0,
      payLightningAddress: async (address, amount, comment) => {
        const { bolt11, preimage } = await window.__e2ePayAddress(
          address,
          amount,
          comment
        )
        window.__e2ePayments = [
          ...(window.__e2ePayments || []),
          { walletId: spec.id, invoice: bolt11, address, comment }
        ]
        return {
          id: `payment-${spec.id}`,
          preimage,
          status: 'completed',
          fee: 0
        }
      },
      payInvoice: async ({ invoice }) => {
        const preimage = await window.__e2ePayInvoice(invoice)
        window.__e2ePayments = [
          ...(window.__e2ePayments || []),
          { walletId: spec.id, invoice }
        ]
        return {
          id: `payment-${spec.id}`,
          preimage,
          status: 'completed',
          fee: 0
        }
      }
    })
    store.wallets = specs.map(({ id, type, name }) => ({
      id,
      type,
      name,
      ...(type === 'nwc'
        ? { nwcString: window.__e2eNwcUrl, nwcUrl: window.__e2eNwcUrl }
        : {})
    }))
    store.activeWalletId = specs[0].id
    store.connectionStates = Object.fromEntries(
      specs.map((spec) => [spec.id, { connected: true }])
    )
    store.providers = {}
    for (const spec of specs) {
      const provider = makeProvider(spec)
      if (spec.type === 'nwc')
        store.connectionStates[spec.id].nwcInstance = provider
      else store.providers[spec.id] = provider
      store.applyBalance(spec.id, spec.balance)
    }
    const providerOf = async (id) =>
      store.getProvider(id || store.activeWalletId)
    store.ensureWalletConnectedForTransfer = providerOf
    store.ensureSparkConnected = providerOf
    store.ensureLNBitsConnected = providerOf
    store.ensureArkadeConnected = providerOf
    store.refreshWalletData = async () => {}
    store.connectAllSparkWallets = async () => {}
  }, wallets)
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const setTheme = (page, dark) =>
  page.evaluate((value) => {
    document
      .querySelector('#q-app')
      .__vue_app__.config.globalProperties.$q.dark.set(value)
  }, dark)

// Through the root component's `$i18n`: a dynamic import of the i18n boot file can resolve to a
// second module instance under Vite's HMR timestamps, which would change nothing on screen.
const setLocale = (page, locale) =>
  page.evaluate((value) => {
    document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n.locale =
      value
  }, locale)

/** Screenshot in light and dark, leaving the page light. */
async function snap({ page, who }, name) {
  currentStep = name
  for (const dark of [false, true]) {
    await setTheme(page, dark)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `${output}/${slug(`${name}-${who.name}`)}-${dark ? 'dark' : 'light'}.png`
    })
  }
  await setTheme(page, false)
}

/**
 * In-app navigation. A page load would drop the scripted wallets (they live in the store, not
 * in storage), so every move after the first load goes through the router.
 */
const navigate = (page, path) =>
  page.evaluate((target) => {
    document
      .querySelector('#q-app')
      .__vue_app__.config.globalProperties.$router.push(target)
  }, path)

/** Open the chat with a contact by tapping its row in the address book. */
async function openChatFromAddressBook({ page }, name) {
  await navigate(page, '/address-book')
  await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
  await page.locator('.chat-header').waitFor()
}

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

async function confirmRealPayment(page) {
  const tap = page.getByRole('button', { name: /^Send .*sats$/ })
  if (await tap.count()) {
    await tap.click()
    return
  }
  const track = await page.locator('.slide-track').boundingBox()
  const thumb = await page.locator('.slide-thumb').boundingBox()
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    track.x + track.width - 10,
    thumb.y + thumb.height / 2,
    { steps: 14 }
  )
  await page.mouse.up()
}
const browser = await chromium.launch({ headless: true })
try {
  actors.alice = await launchUser(browser, ALICE)
  actors.bob = await launchUser(browser, BOB)
  actors.carol = await launchUser(browser, CAROL)
  actors.dave = await launchUser(browser, DAVE)
  const { alice, bob, carol, dave } = actors
  await seedUser(alice, {
    contacts: [BOB, CAROL, DAVE],
    wallets: ALICE_WALLETS.filter((wallet) => wallet.type !== 'arkade'),
    profileAddress: ALICE_ADDRESS
  })
  await seedUser(bob, {
    contacts: [ALICE],
    wallets: BOB_WALLETS.filter((wallet) => wallet.type !== 'arkade')
  })
  await seedUser(carol, {
    contacts: [ALICE],
    wallets: BOB_WALLETS.filter((wallet) => wallet.type !== 'arkade').map(
      (wallet) => ({ ...wallet, id: wallet.id.replace('bob', 'carol') })
    )
  })
  await seedUser(dave, {
    contacts: [ALICE],
    wallets: BOB_WALLETS.filter((wallet) => wallet.type !== 'arkade').map(
      (wallet) => ({ ...wallet, id: wallet.id.replace('bob', 'dave') })
    )
  })
  await navigate(alice.page, '/requests')
  await alice.page.locator('.request-goals__footer .form-sheet-primary').click()
  await alice.page.locator('.request-from').waitFor()
  for (const name of ['Bob', 'Carol', 'Dave'])
    await alice.page
      .locator('.request-from__row')
      .filter({ hasText: name })
      .click()
  await snap(alice, '01-multiple-picker')
  await alice.page.locator('.request-from__footer .form-sheet-primary').click()
  await alice.page.locator('.shared-request').waitFor()
  for (const key of ['3', '6', '000'])
    await alice.page
      .locator('.shared-request .amount-keypad__key')
      .getByText(key, { exact: true })
      .click()
  await alice.page.locator('.request-note button').click()
  await alice.page
    .getByRole('textbox', { name: 'Note (optional)' })
    .fill('Weekend cabin')
  await snap(alice, '02-equal-shares')
  await alice.page.getByRole('radio', { name: 'By amount' }).click()
  const amount = (name) =>
    alice.page.getByRole('textbox', { name: `Amount for ${name}`, exact: true })
  await amount('Bob').click()
  await amount('Bob').fill('10000')
  await amount('Carol').fill('14000')
  await amount('Carol').press('Enter')
  assert.equal(
    await amount('Dave').evaluate(
      (element) => element === document.activeElement
    ),
    true
  )
  await amount('Dave').press('Enter')
  await snap(alice, '03-individual-amounts')
  await alice.page
    .locator('.shared-request__footer .form-sheet-primary')
    .click()
  await alice.page.locator('.request-goals__people').waitFor()
  await snap(alice, '04-private-goal')
  const goalId = await alice.page.evaluate(async () => {
    const { useMessagesStore } = await import('/src/stores/messages.js')
    return useMessagesStore().requestGoalsSorted[0].id
  })
  await openChatFromAddressBook(bob, 'Alice')
  await bob.page
    .locator('.request-card')
    .filter({ hasText: 'Weekend cabin' })
    .waitFor()
  await snap(bob, '05-private-payer-card')
  const card = bob.page
    .locator('.request-card')
    .filter({ hasText: 'Weekend cabin' })
  assert.ok(!(await card.innerText()).includes('Carol'))
  assert.equal(await bob.page.locator('.chat-goal-progress').count(), 0)
  await card.getByRole('button', { name: 'Pay', exact: true }).click()
  await bob.page.getByText('Pay with', { exact: true }).waitFor()
  await bob.page.getByRole('button', { name: /Pay with/ }).click()
  await bob.page
    .getByRole('listbox')
    .getByRole('option', { name: /Alby Hub/ })
    .click()
  await bob.page.screenshot({ path: `${output}/06-confirm-payment.png` })
  await bob.page.getByRole('button', { name: /^Send .*sats$/ }).click()
  await bob.page.getByText('Payment Sent', { exact: true }).waitFor()
  assert.equal(
    nwcPayments.length,
    1,
    'the real NWC send service paid exactly once'
  )
  await alice.page.getByText('1 of 3 paid', { exact: true }).waitFor()
  await snap(alice, '06b-nwc-verified-progress')
  for (const payer of [carol, dave]) {
    await openChatFromAddressBook(payer, 'Alice')
    await payer.page
      .locator('.request-card')
      .filter({ hasText: 'Weekend cabin' })
      .getByRole('button', { name: 'Pay', exact: true })
      .click()
    await payer.page.getByText('Pay with', { exact: true }).waitFor()
    await confirmRealPayment(payer.page)
    await payer.page.getByText('Payment Sent', { exact: true }).waitFor()
  }
  await alice.page.getByText('Everyone has paid', { exact: true }).waitFor()
  await snap(alice, '06c-everyone-paid')
  await alice.page.locator('.request-goals__person-main').first().click()
  await alice.page.locator('.chat-goal-progress').waitFor()
  await snap(alice, '06d-requester-chat-progress')
  await alice.page.locator('.chat-goal-progress').click()
  await alice.page.getByText('Everyone has paid', { exact: true }).waitFor()
  await alice.page.setViewportSize({ width: 320, height: 740 })
  await snap(alice, '07-small-screen-progress')
  await navigate(alice.page, '/requests')
  await alice.page.locator('.request-goals__footer .form-sheet-primary').click()
  for (const name of ['Bob', 'Carol', 'Dave'])
    await alice.page
      .locator('.request-from__row')
      .filter({ hasText: name })
      .click()
  await alice.page.locator('.request-from__footer .form-sheet-primary').click()
  await alice.page.getByRole('radio', { name: 'By amount' }).click()
  for (const [name, value] of [
    ['Bob', '10000'],
    ['Carol', '14000'],
    ['Dave', '12000']
  ])
    await amount(name).fill(value)
  await snap(alice, '08-small-screen-amounts')
  await setLocale(alice.page, 'de')
  await snap(alice, '09-german-amounts')
  await setLocale(alice.page, 'es')
  await snap(alice, '10-spanish-amounts')
  await setLocale(alice.page, 'en-US')
  await alice.page.locator('.shared-request__close').click()
  // An outgoing receipt goes through the same native picker/sheet, fee excluded.
  await alice.page.evaluate(async () => {
    localStorage.setItem(
      'buhoGO_cached_transactions',
      JSON.stringify([
        {
          id: 'dinner-paid',
          walletId: 'alice-spark',
          walletType: 'spark',
          type: 'outgoing',
          status: 'completed',
          amount: 48060,
          recipientSats: 48000,
          fee: 60,
          created_at: Date.now(),
          description: 'Dinner',
          note: 'Dinner'
        }
      ])
    )
  })
  await navigate(alice.page, '/transaction/dinner-paid?wallet=alice-spark')
  await alice.page
    .getByRole('button', { name: 'Request repayment', exact: true })
    .click()
  for (const name of ['Bob', 'Carol', 'Dave'])
    await alice.page
      .locator('.request-from__row')
      .filter({ hasText: name })
      .click()
  await alice.page.locator('.request-from__footer .form-sheet-primary').click()
  await snap(alice, '11-repayment-from-receipt')
  await alice.page.getByRole('radio', { name: 'By amount' }).click()
  await amount('Bob').fill('10000')
  await amount('Carol').fill('14000')
  await amount('Dave').fill('12000')
  await snap(alice, '12-repayment-own-remainder')
  assert.ok(
    (
      await alice.page
        .locator('.shared-request__footer .form-sheet-primary')
        .innerText()
    ).includes('36,000')
  )
  await alice.page
    .locator('.shared-request__footer .form-sheet-primary')
    .click()
  await alice.page.locator('.request-goals__people').waitFor()
  assert.ok(
    (await alice.page.locator('.request-goals__own').innerText()).includes(
      '12,000'
    )
  )
  await navigate(alice.page, '/transaction/dinner-paid?wallet=alice-spark')
  await alice.page
    .getByRole('button', { name: 'View repayment', exact: true })
    .click()
  await alice.page.locator('.request-goals__people').waitFor()
  assert.equal(
    await alice.page.evaluate(async () => {
      const { useMessagesStore } = await import('/src/stores/messages.js')
      return useMessagesStore().requestGoalsSorted.length
    }),
    2,
    'a receipt has only one repayment goal'
  )
  await alice.page.evaluate(async () => {
    const { useMessagesStore } = await import('/src/stores/messages.js')
    await useMessagesStore().flush()
  })
  console.log('Checking repayment persistence after reload')
  await alice.page.reload()
  await alice.page.locator('.request-goals__people').waitFor()
  await seedWallets(alice, ALICE_WALLETS)
  await navigate(alice.page, `/requests/${goalId}`)
  await alice.page.getByText('Everyone has paid', { exact: true }).waitFor()
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  console.log(
    'Shared requests: native equal/individual entry, private delivery, NWC/Spark payments, progress, repayment, restart, locales and small screens passed.'
  )
} catch (error) {
  console.error(error)
  console.error(pageErrors)
  if (actors.alice)
    console.error(
      await actors.alice.page
        .evaluate(async () => {
          const { useMessagesStore } = await import('/src/stores/messages.js')
          const { useIdentityStore } = await import('/src/stores/identity.js')
          const { useChatRuntime } =
            await import('/src/composables/useChatRuntime.js')
          const { loadChatState } = await import('/src/utils/dmStorage.js')
          const messages = useMessagesStore(),
            identity = useIdentityStore(),
            runtime = useChatRuntime()
          const saved = identity.nostrPubkeyHex
            ? await loadChatState(identity.nostrPubkeyHex)
            : null
          return {
            url: location.hash,
            identity: identity.nostrPubkeyHex,
            runtime: runtime.me.value,
            scope: messages.scope,
            goalCount: messages.requestGoalsSorted.length,
            savedGoals: Object.keys(saved?.requestGoals || {}),
            page: document.body.innerText.slice(0, 600)
          }
        })
        .catch((error) => ({ diagnostic: error.message }))
    )
  await saveFailureShots()
  process.exitCode = 1
} finally {
  await browser.close()
}
