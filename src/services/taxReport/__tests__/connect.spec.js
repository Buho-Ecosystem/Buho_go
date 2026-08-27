/**
 * Opening wallets for a report without breaking the one the user is on.
 *
 * The app keeps exactly one wallet live. A report over several has to open
 * them itself, and the two ways that goes wrong are both here: two Spark
 * providers alive at once (which costs the active wallet its session on
 * Android), and a report that finishes leaving the user on a different
 * connection than the one they started with.
 *
 * Run directly with Node:
 *   node src/services/taxReport/__tests__/connect.spec.js
 */

import { strict as assert } from 'node:assert'
import { createReportConnector } from '../connect.js'

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed += 1
  }
}

/** A fake of the wallet store, faithful to the parts that matter. */
function fakeStore(wallets, activeWalletId) {
  const store = {
    wallets,
    activeWalletId,
    providers: {},
    log: [],
    async connectWallet(id) {
      const w = wallets.find((x) => x.id === id)
      if (!w) throw new Error('no such wallet')
      if (w.broken) throw new Error('unreachable')
      store.log.push(`connect:${id}`)
      store.providers[id] = { getTransactions: async () => [] }
    },
    async _disconnectSparkProvider(id) {
      store.log.push(`disconnect:${id}`)
      delete store.providers[id]
    },
    async connectAllSparkWallets() {
      store.log.push('restore')
      for (const w of wallets) {
        if (w.type === 'spark' && w.id !== activeWalletId) delete store.providers[w.id]
      }
      const active = wallets.find((w) => w.id === activeWalletId)
      if (active?.type === 'spark') store.providers[active.id] = { getTransactions: async () => [] }
    },
  }
  // The active wallet is the one the app has live.
  store.providers[activeWalletId] = { getTransactions: async () => [] }
  return store
}

const W = {
  sparkA: { id: 'sA', name: 'Business', type: 'spark' },
  sparkB: { id: 'sB', name: 'Personal', type: 'spark' },
  lnbits: { id: 'ln', name: 'Shop', type: 'lnbits' },
  nwc: { id: 'nw', name: 'Alby', type: 'nwc' },
}

// ── the exclusivity rule ───────────────────────────────────────────────────

await test('a second Spark wallet is opened only after the first is closed', async () => {
  const store = fakeStore([W.sparkA, W.sparkB], 'sA')
  const c = createReportConnector(store)

  await c.connect(W.sparkA)   // already live, must cost nothing
  await c.connect(W.sparkB)

  assert.deepEqual(store.log, ['disconnect:sA', 'connect:sB'])
  assert.equal(Object.keys(store.providers).length, 1, 'never two Spark providers at once')
})

await test('the wallet the user was on comes back', async () => {
  const store = fakeStore([W.sparkA, W.sparkB], 'sA')
  const c = createReportConnector(store)

  await c.connect(W.sparkB)
  await c.restore()

  assert.equal(store.log.at(-1), 'restore')
  assert.ok(store.providers.sA, 'the active wallet is live again')
  assert.ok(!store.providers.sB, 'the one we borrowed is not')
})

await test('restore does nothing when Spark was never moved', async () => {
  const store = fakeStore([W.sparkA, W.lnbits, W.nwc], 'sA')
  const c = createReportConnector(store)

  await c.connect(W.lnbits)
  await c.connect(W.nwc)
  await c.restore()

  assert.ok(!store.log.includes('restore'), 'no reconnect the user did not need')
  assert.ok(store.providers.sA && store.providers.ln && store.providers.nw)
})

await test('restore survives a store that throws', async () => {
  const store = fakeStore([W.sparkA, W.sparkB], 'sA')
  store.connectAllSparkWallets = async () => { throw new Error('sdk down') }
  const c = createReportConnector(store)

  await c.connect(W.sparkB)
  await c.restore() // must not reject: the report is already written
})

// ── not paying for what is already open ────────────────────────────────────

await test('a live wallet is handed back without reconnecting', async () => {
  const store = fakeStore([W.lnbits], 'ln')
  const c = createReportConnector(store)

  const p = await c.connect(W.lnbits)
  assert.equal(store.log.length, 0, 'no handshake for a wallet already open')
  assert.equal(typeof p.getTransactions, 'function')
})

await test('the live wallet is read first', async () => {
  const store = fakeStore([W.sparkA, W.sparkB, W.lnbits], 'ln')
  const c = createReportConnector(store)

  // Its rows are in hand before anything that has to be opened can fail.
  assert.deepEqual(c.order([W.sparkA, W.sparkB, W.lnbits]).map((w) => w.id), ['ln', 'sA', 'sB'])
})

// ── failure is a null, not an explosion ────────────────────────────────────

await test('a wallet that will not open throws for the caller to name', async () => {
  const store = fakeStore([W.lnbits, { ...W.nwc, broken: true }], 'ln')
  const c = createReportConnector(store)

  await assert.rejects(() => c.connect({ ...W.nwc, broken: true }))
})

await test('a wallet with no id is nothing, not a crash', async () => {
  const store = fakeStore([W.lnbits], 'ln')
  const c = createReportConnector(store)
  assert.equal(await c.connect({}), null)
  assert.equal(await c.connect(null), null)
})

// ── NWC, which the store connects but files nowhere ────────────────────────

await test('an NWC wallet gets a provider that can actually be read', async () => {
  // The store connects NWC by keeping a raw NostrWebLNProvider on its
  // connection state; nothing lands in `providers`. Without this, every NWC
  // wallet in a report would be listed as unreadable.
  const store = fakeStore([W.lnbits, W.nwc], 'ln')
  store.connectWallet = async (id) => { store.log.push(`connect:${id}`) } // files nothing

  let built = null
  const c = createReportConnector(store, {
    createProvider: async (w) => {
      built = { wallet: w, connected: false, closed: false,
        async connect() { this.connected = true },
        async disconnect() { this.closed = true },
        async getTransactions() { return [] } }
      return built
    },
  })

  const p = await c.connect(W.nwc)
  assert.equal(typeof p.getTransactions, 'function')
  assert.equal(built.wallet.id, 'nw')
  assert.ok(built.connected, 'opened before it is read')

  await c.restore()
  assert.ok(built.closed, 'a relay connection is not left running')
})

await test('a provider we cannot build is null, not a thrown report', async () => {
  const store = fakeStore([W.nwc], 'nw')
  store.providers = {}
  store.connectWallet = async () => {}
  const c = createReportConnector(store, { createProvider: async () => ({}) })
  assert.equal(await c.connect(W.nwc), null)
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
