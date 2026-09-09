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

/**
 * A fake of the wallet store, faithful to the parts that matter.
 *
 * The fidelity that counts here: the real store files a provider under
 * `providers` for Spark, LNbits and Arkade, and files NOTHING for NWC (it
 * keeps a raw NostrWebLNProvider on its connection state instead). A fake that
 * gets that wrong would prove the opposite of what these tests claim.
 */
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
      if (w.type !== 'nwc') store.providers[id] = { getTransactions: async () => [] }
    },
    async disconnectWallet(id) {
      store.log.push(`close:${id}`)
      delete store.providers[id]
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

/** A provider the report builds for itself, with its lifetime observable. */
function fakeOwnProvider(record) {
  return async (w) => {
    const p = {
      wallet: w,
      connected: false,
      closed: false,
      async connect() { this.connected = true },
      async disconnect() { this.closed = true },
      async getTransactions() { return [] },
    }
    record.push(p)
    return p
  }
}

const W = {
  sparkA: { id: 'sA', name: 'Business', type: 'spark' },
  sparkB: { id: 'sB', name: 'Personal', type: 'spark' },
  lnbits: { id: 'ln', name: 'Shop', type: 'lnbits' },
  arkade: { id: 'ark', name: 'Ark', type: 'arkade' },
  nwc: { id: 'nw', name: 'Alby', type: 'nwc' },
}

// ── the exclusivity rule ───────────────────────────────────────────────────

await test('a second Spark wallet is opened only after the first is closed', async () => {
  const store = fakeStore([W.sparkA, W.sparkB], 'sA')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await c.connect(W.sparkA)   // already live, must cost nothing
  await c.connect(W.sparkB)

  assert.deepEqual(store.log, ['disconnect:sA', 'connect:sB'])
  assert.equal(Object.keys(store.providers).length, 1, 'never two Spark providers at once')
})

await test('the wallet the user was on comes back', async () => {
  const store = fakeStore([W.sparkA, W.sparkB], 'sA')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await c.connect(W.sparkB)
  await c.restore()

  assert.equal(store.log.at(-1), 'restore')
  assert.ok(store.providers.sA, 'the active wallet is live again')
  assert.ok(!store.providers.sB, 'the one we borrowed is not')
})

await test('restore does not reconnect Spark when Spark was never moved', async () => {
  const store = fakeStore([W.sparkA, W.lnbits], 'sA')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await c.connect(W.lnbits)
  await c.restore()

  assert.ok(!store.log.includes('restore'), 'no reconnect the user did not need')
  assert.ok(store.providers.sA, 'the active Spark wallet was never touched')
})

await test('restore survives a store that throws', async () => {
  const store = fakeStore([W.sparkA, W.sparkB], 'sA')
  store.connectAllSparkWallets = async () => { throw new Error('sdk down') }
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await c.connect(W.sparkB)
  await c.restore() // must not reject: the report is already written
})

// ── not paying for what is already open ────────────────────────────────────

await test('a live wallet is handed back without reconnecting', async () => {
  const store = fakeStore([W.lnbits], 'ln')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  const p = await c.connect(W.lnbits)
  assert.equal(store.log.length, 0, 'no handshake for a wallet already open')
  assert.equal(typeof p.getTransactions, 'function')
})

await test('the live wallet is read first', async () => {
  const store = fakeStore([W.sparkA, W.sparkB, W.lnbits], 'ln')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  // Its rows are in hand before anything that has to be opened can fail.
  assert.deepEqual(c.order([W.sparkA, W.sparkB, W.lnbits]).map((w) => w.id), ['ln', 'sA', 'sB'])
})

// ── failure is a null, not an explosion ────────────────────────────────────

await test('a wallet that will not open throws for the caller to name', async () => {
  const broken = { ...W.arkade, broken: true }
  const store = fakeStore([W.lnbits, broken], 'ln')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await assert.rejects(() => c.connect(broken))
})

await test('a wallet with no id is nothing, not a crash', async () => {
  const store = fakeStore([W.lnbits], 'ln')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })
  assert.equal(await c.connect({}), null)
  assert.equal(await c.connect(null), null)
})

// ── NWC: opened directly, never through the store ──────────────────────────

await test('an NWC wallet gets a provider that can actually be read', async () => {
  // The store files nothing readable for NWC, so the report builds the
  // provider that has a getTransactions and owns its lifetime.
  const store = fakeStore([W.lnbits, W.nwc], 'ln')
  const built = []
  const c = createReportConnector(store, { createProvider: fakeOwnProvider(built) })

  const p = await c.connect(W.nwc)
  assert.equal(typeof p.getTransactions, 'function')
  assert.equal(built[0].wallet.id, 'nw')
  assert.ok(built[0].connected, 'opened before it is read')
})

await test('opening NWC never asks the store to connect it as well', async () => {
  // Asking the store would open a SECOND relay connection, filed on the
  // connection state, that nothing ever closes and that still could not be
  // read from.
  const store = fakeStore([W.lnbits, W.nwc], 'ln')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await c.connect(W.nwc)
  assert.deepEqual(store.log, [], 'the store was not involved')
})

await test('a provider we cannot build is null, not a thrown report', async () => {
  const store = fakeStore([W.nwc], 'nw')
  store.providers = {}
  const c = createReportConnector(store, { createProvider: async () => ({}) })
  assert.equal(await c.connect(W.nwc), null)
})

// ── what we open, we close ─────────────────────────────────────────────────

await test('every connection the report opened is closed again', async () => {
  const store = fakeStore([W.lnbits, W.nwc, W.arkade], 'ln')
  const built = []
  const c = createReportConnector(store, { createProvider: fakeOwnProvider(built) })

  await c.connect(W.lnbits)  // already live, not ours
  await c.connect(W.nwc)     // ours
  await c.connect(W.arkade)  // the store's, but opened at our request
  await c.restore()

  assert.ok(built[0].closed, 'the NWC relay connection is not left running')
  assert.ok(!store.providers.ark, 'the Arkade provider is not left live with its background callbacks wired')
  assert.ok(store.providers.ln, 'the wallet the user is on stays connected')
})

await test('the wallet the user is looking at is never closed to tidy up', async () => {
  // Its provider is missing (a failed auto-connect at boot), so the report
  // opens it. Closing it afterwards would leave the user staring at a
  // disconnected wallet because they made a report.
  const store = fakeStore([W.lnbits], 'ln')
  delete store.providers.ln
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await c.connect(W.lnbits)
  await c.restore()

  assert.ok(store.providers.ln, 'still connected')
  assert.ok(!store.log.includes('close:ln'))
})

await test('restore can be called twice without closing anything twice', async () => {
  // The sheet calls it from the run's own finally, and the run may already
  // have been abandoned by a dismissal.
  const store = fakeStore([W.lnbits, W.arkade], 'ln')
  const built = []
  const c = createReportConnector(store, { createProvider: fakeOwnProvider(built) })

  await c.connect(W.arkade)
  await c.restore()
  const after = [...store.log]
  await c.restore()
  assert.deepEqual(store.log, after, 'the second call did nothing')
})

// ── the Spark failure path, which is where restore matters most ────────────

await test('a Spark wallet that will not open still hands the user theirs back', async () => {
  // The live Spark provider has already been torn down by the time the open
  // fails, so without a restore the user is left on no Spark wallet at all.
  const broken = { ...W.sparkB, broken: true }
  const store = fakeStore([W.sparkA, broken], 'sA')
  const c = createReportConnector(store, { createProvider: fakeOwnProvider([]) })

  await assert.rejects(() => c.connect(broken))
  assert.ok(!store.providers.sA, 'torn down, as the exclusivity rule requires')

  await c.restore()
  assert.equal(store.log.at(-1), 'restore')
  assert.ok(store.providers.sA, 'the user is back on their own wallet')
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
