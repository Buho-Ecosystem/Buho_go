/**
 * payingWallets - the "Pay with" verdict.
 *
 * Coverage focus:
 *   - all four wallet types against every rail (the walletCapabilities matrix
 *     seen through the list)
 *   - ordering: active first, everyone else in stored order
 *   - the three stable reasons and their precedence
 *   - amountless invoices and unknown balances never read as insufficient
 *   - the default pick
 *   - the shared fee reserve and its zero-fee / known-fee variant
 *   - the one-sentence reason when no wallet can pay
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PAYING_REASON,
  FEE_RESERVE_RATIO,
  FEE_RESERVE_MIN_SATS,
  feeReserveSats,
  knownFeeReserveSats,
  listPayingWallets,
  payingWalletsInStore,
  pickDefaultPayingWallet,
  payingWalletReasonText,
  payingWalletHint,
  payingBlockedText,
  requestPayability,
} from '../payingWallets.js'

const WALLETS = [
  { id: 'spark-biz', name: 'Business', type: 'spark' },
  { id: 'spark-personal', name: 'Personal', type: 'spark' },
  { id: 'nwc', name: 'Alby Hub', type: 'nwc' },
  { id: 'lnbits', name: 'My LNbits', type: 'lnbits' },
  { id: 'arkade', name: 'Arkade', type: 'arkade' },
]

const RICH = { 'spark-biz': 50_000, 'spark-personal': 50_000, nwc: 50_000, lnbits: 50_000, arkade: 50_000 }

const list = (overrides = {}) => listPayingWallets({
  wallets: WALLETS,
  activeWalletId: 'spark-biz',
  balances: RICH,
  connectionStates: {},
  destinationType: 'lightning_invoice',
  amountSats: 0,
  ...overrides,
})
const byId = (entries, id) => entries.find((w) => w.id === id)
const usableIds = (entries) => entries.filter((w) => w.usable).map((w) => w.id)

// identity translate with {placeholder} substitution - asserts on the English key
const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name)

test('every entry carries exactly the documented fields', () => {
  const [first] = list()
  assert.deepEqual(Object.keys(first).sort(), ['balanceSats', 'connectionFailed', 'id', 'isActive', 'name', 'reason', 'type', 'usable'])
  assert.deepEqual(first, {
    id: 'spark-biz', name: 'Business', type: 'spark', balanceSats: 50_000,
    isActive: true, usable: true, reason: null, connectionFailed: false,
  })
})

test('Lightning: Spark, NWC and LNbits pay, Arkade cannot', () => {
  for (const destinationType of ['lightning_invoice', 'lightning_address', 'lnurl', 'lightning']) {
    const entries = list({ destinationType })
    assert.deepEqual(usableIds(entries).sort(), ['lnbits', 'nwc', 'spark-biz', 'spark-personal'], destinationType)
    assert.equal(byId(entries, 'arkade').reason, PAYING_REASON.UNSUPPORTED_DESTINATION)
  }
})

test('Spark addresses: only Spark wallets pay', () => {
  for (const destinationType of ['spark_address', 'spark']) {
    const entries = list({ destinationType })
    assert.deepEqual(usableIds(entries).sort(), ['spark-biz', 'spark-personal'])
    for (const id of ['nwc', 'lnbits', 'arkade']) {
      assert.equal(byId(entries, id).reason, 'unsupported-destination', id)
    }
  }
})

test('Arkade addresses: only the Arkade wallet pays', () => {
  for (const destinationType of ['arkade_address', 'arkade']) {
    assert.deepEqual(usableIds(list({ destinationType })), ['arkade'])
  }
})

test('on-chain: Spark and Arkade pay, NWC and LNbits cannot', () => {
  for (const destinationType of ['bitcoin_address', 'bitcoin']) {
    const entries = list({ destinationType })
    assert.deepEqual(usableIds(entries).sort(), ['arkade', 'spark-biz', 'spark-personal'])
    assert.equal(byId(entries, 'nwc').reason, 'unsupported-destination')
    assert.equal(byId(entries, 'lnbits').reason, 'unsupported-destination')
  }
})

test('the list agrees with canWalletPay for every wallet type and rail', async () => {
  const { canWalletPay } = await import('../walletCapabilities.js')
  for (const destinationType of ['lightning_invoice', 'spark_address', 'arkade_address', 'bitcoin_address']) {
    for (const entry of list({ destinationType })) {
      assert.equal(entry.usable, canWalletPay(entry.type, destinationType), `${entry.type} x ${destinationType}`)
    }
  }
})

test('an unrecognized or missing destination type is a Lightning destination', () => {
  assert.equal(byId(list({ destinationType: 'phone_number' }), 'arkade').usable, false)
  assert.equal(byId(list({ destinationType: undefined }), 'arkade').usable, false)
  assert.equal(byId(list({ destinationType: undefined }), 'nwc').usable, true)
})

test('the active wallet leads, everyone else keeps their stored order', () => {
  assert.deepEqual(list({ activeWalletId: 'spark-biz' }).map((w) => w.id),
    ['spark-biz', 'spark-personal', 'nwc', 'lnbits', 'arkade'])
  assert.deepEqual(list({ activeWalletId: 'lnbits' }).map((w) => w.id),
    ['lnbits', 'spark-biz', 'spark-personal', 'nwc', 'arkade'])
  assert.deepEqual(list({ activeWalletId: 'arkade' }).map((w) => w.id),
    ['arkade', 'spark-biz', 'spark-personal', 'nwc', 'lnbits'])
  const entries = list({ activeWalletId: 'nwc' })
  assert.deepEqual(entries.filter((w) => w.isActive).map((w) => w.id), ['nwc'])
})

test('an unknown or missing active wallet keeps the stored order and flags nobody', () => {
  for (const activeWalletId of [null, undefined, 'gone']) {
    const entries = list({ activeWalletId })
    assert.deepEqual(entries.map((w) => w.id), WALLETS.map((w) => w.id))
    assert.equal(entries.some((w) => w.isActive), false)
  }
})

test('does not mutate its inputs', () => {
  const wallets = WALLETS.map((w) => ({ ...w }))
  const snapshot = JSON.stringify(wallets)
  listPayingWallets({ wallets, activeWalletId: 'arkade', balances: RICH })
  assert.equal(JSON.stringify(wallets), snapshot)
})

test('empty, missing and malformed input degrade to an empty list', () => {
  assert.deepEqual(listPayingWallets(), [])
  assert.deepEqual(listPayingWallets({}), [])
  assert.deepEqual(listPayingWallets({ wallets: null }), [])
  assert.deepEqual(listPayingWallets({ wallets: [null, {}, { name: 'no id' }] }), [])
})

test('a wallet saved before the type field existed is an NWC wallet', () => {
  const [entry] = listPayingWallets({ wallets: [{ id: 'old', name: 'Old' }], activeWalletId: 'old' })
  assert.equal(entry.type, 'nwc')
  assert.equal(entry.usable, true)
})

test('balance below amount plus reserve is insufficient; exactly enough is usable', () => {
  const balances = { ...RICH, nwc: 1_009, lnbits: 1_010, 'spark-personal': 999 }
  const entries = list({ balances, amountSats: 1_000, feeReserve: 10 })
  assert.equal(byId(entries, 'nwc').reason, PAYING_REASON.INSUFFICIENT_BALANCE)
  assert.equal(byId(entries, 'nwc').usable, false)
  assert.equal(byId(entries, 'lnbits').usable, true)
  assert.equal(byId(entries, 'spark-personal').reason, 'insufficient-balance')
  assert.equal(byId(entries, 'spark-biz').usable, true)
})

test('the default reserve is the shared 1 % / 10 sat rule', () => {
  assert.equal(FEE_RESERVE_RATIO, 0.01)
  assert.equal(FEE_RESERVE_MIN_SATS, 10)
  assert.equal(feeReserveSats(100), 10)         // the floor
  assert.equal(feeReserveSats(1_000), 10)       // 1 % == the floor
  assert.equal(feeReserveSats(10_000), 100)     // 1 %
  assert.equal(feeReserveSats(10_001), 101)     // rounds up
  // The formula the Nip05 marketplace sheet has always used.
  for (const total of [1, 99, 1_000, 2_345, 99_999, 1_000_000]) {
    assert.equal(feeReserveSats(total), Math.max(10, Math.ceil(total * 0.01)))
  }
  // Without an explicit feeReserve the list applies it.
  const balances = { ...RICH, nwc: 10_099, lnbits: 10_100 }
  const entries = list({ balances, amountSats: 10_000 })
  assert.equal(byId(entries, 'nwc').reason, 'insufficient-balance')
  assert.equal(byId(entries, 'lnbits').usable, true)
})

test('an explicit feeReserve of 0 turns the reserve off', () => {
  const entries = list({ balances: { ...RICH, nwc: 1_000 }, amountSats: 1_000, feeReserve: 0 })
  assert.equal(byId(entries, 'nwc').usable, true)
  const strict = list({ balances: { ...RICH, nwc: 1_000 }, amountSats: 1_000 })
  assert.equal(byId(strict, 'nwc').usable, false)
})

test('a non-numeric feeReserve falls back to the default reserve', () => {
  for (const feeReserve of [null, undefined, NaN, '5', -3]) {
    const entries = list({ balances: { ...RICH, nwc: 1_005 }, amountSats: 1_000, feeReserve })
    assert.equal(byId(entries, 'nwc').reason, 'insufficient-balance', String(feeReserve))
  }
})

test('amountless invoices skip the balance check until an amount exists', () => {
  const broke = { 'spark-biz': 0, 'spark-personal': 0, nwc: 0, lnbits: 0, arkade: 0 }
  for (const amountSats of [0, undefined, null, NaN, -5, '']) {
    const entries = list({ balances: broke, amountSats })
    assert.deepEqual(usableIds(entries).sort(), ['lnbits', 'nwc', 'spark-biz', 'spark-personal'], String(amountSats))
  }
  const typed = list({ balances: broke, amountSats: 1 })
  assert.deepEqual(usableIds(typed), [])
  assert.ok(typed.filter((w) => w.type !== 'arkade').every((w) => w.reason === 'insufficient-balance'))
})

test('an unknown balance is shown as null and never counts as insufficient', () => {
  const entries = list({ balances: { 'spark-biz': 5 }, amountSats: 1_000 })
  assert.equal(byId(entries, 'nwc').balanceSats, null)
  assert.equal(byId(entries, 'nwc').usable, true)
  assert.equal(byId(entries, 'spark-biz').balanceSats, 5)
  assert.equal(byId(entries, 'spark-biz').reason, 'insufficient-balance')
  for (const bad of [null, undefined, NaN, Infinity, '12']) {
    assert.equal(byId(list({ balances: { nwc: bad } }), 'nwc').balanceSats, null, String(bad))
  }
  assert.equal(byId(list({ balances: { nwc: -4 } }), 'nwc').balanceSats, 0)
  assert.equal(byId(list({ balances: { nwc: 12.9 } }), 'nwc').balanceSats, 12)
  assert.equal(listPayingWallets({ wallets: WALLETS, balances: undefined })[0].balanceSats, null)
})

test('a wallet whose last connection failed stays usable: every send path reconnects', () => {
  const connectionStates = { nwc: { connected: false, error: 'relay unreachable' } }
  const entries = list({ connectionStates })
  assert.equal(byId(entries, 'nwc').usable, true)
  assert.equal(byId(entries, 'nwc').reason, null)
  assert.equal(byId(entries, 'nwc').connectionFailed, true)
  assert.equal(byId(entries, 'lnbits').connectionFailed, false)
})

test('not connected yet is not a failed connection: it connects on demand', () => {
  const connectionStates = {
    nwc: undefined,                                                   // never tried
    lnbits: { connected: false, error: null },                        // locked / disconnected without a failure
    arkade: { connected: false, lastConnected: 1 },                   // no error field at all
    'spark-personal': { connected: true, error: null },
  }
  const entries = list({ connectionStates })
  for (const id of ['nwc', 'lnbits', 'spark-personal']) {
    assert.equal(byId(entries, id).usable, true, id)
    assert.equal(byId(entries, id).connectionFailed, false, id)
  }
  assert.equal(byId(list({ connectionStates, destinationType: 'arkade_address' }), 'arkade').usable, true)
})

test('a connected wallet is never a failed connection, even with a leftover error text', () => {
  const entries = list({ connectionStates: { nwc: { connected: true, error: 'old' } } })
  assert.equal(byId(entries, 'nwc').connectionFailed, false)
})

test('reason precedence: rail first, then balance', () => {
  const entries = list({ balances: { ...RICH, arkade: 0, nwc: 0 }, amountSats: 500 })
  // Arkade cannot pay Lightning at all: that outranks its empty balance.
  assert.equal(byId(entries, 'arkade').reason, 'unsupported-destination')
  assert.equal(byId(entries, 'nwc').reason, 'insufficient-balance')
})

test('default pick: a wallet whose connection failed is passed over while another can pay', () => {
  const failed = { lnbits: { connected: false, error: 'down' } }
  assert.notEqual(pickDefaultPayingWallet(list({ activeWalletId: 'lnbits', connectionStates: failed })).id, 'lnbits')
  // ...and still taken when it is the only one that can pay.
  const only = listPayingWallets({
    wallets: [{ id: 'lnb', type: 'lnbits' }, { id: 'ark', type: 'arkade' }],
    activeWalletId: 'lnb',
    connectionStates: { lnb: { connected: false, error: 'down' } },
  })
  assert.equal(pickDefaultPayingWallet(only).id, 'lnb')
})

test('default pick: the active wallet when it can pay', () => {
  const entries = list({ activeWalletId: 'lnbits' })
  assert.equal(pickDefaultPayingWallet(entries).id, 'lnbits')
})

test('default pick: the first usable wallet when the active one cannot pay', () => {
  // Arkade active, Lightning invoice: falls to the first usable in stored order.
  const entries = list({ activeWalletId: 'arkade' })
  assert.equal(pickDefaultPayingWallet(entries).id, 'spark-biz')
  // NWC active, Spark-address destination.
  assert.equal(pickDefaultPayingWallet(list({ activeWalletId: 'nwc', destinationType: 'spark_address' })).id, 'spark-biz')
  // Active Business is short, Personal can pay.
  const short = list({ balances: { ...RICH, 'spark-biz': 10 }, amountSats: 5_000 })
  assert.equal(pickDefaultPayingWallet(short).id, 'spark-personal')
  // Active wallet failed to connect.
  const down = list({ connectionStates: { 'spark-biz': { connected: false, error: 'offline' } } })
  assert.equal(pickDefaultPayingWallet(down).id, 'spark-personal')
})

test('default pick: the active wallet again when nothing can pay, so the sheet can say why', () => {
  // Nobody here can pay an Arkade address: the active wallet stays selected and unusable.
  const none = listPayingWallets({
    wallets: WALLETS.filter((w) => w.type !== 'arkade'), activeWalletId: 'nwc', destinationType: 'arkade_address',
  })
  assert.equal(usableIds(none).length, 0)
  assert.equal(pickDefaultPayingWallet(none).id, 'nwc')
  assert.equal(pickDefaultPayingWallet(none).usable, false)
  // Everyone is short: still the active wallet, with the reason on it.
  const broke = list({ activeWalletId: 'lnbits', balances: {}, amountSats: 1, feeReserve: 0 })
  assert.equal(usableIds(broke).length, 4, 'unknown balances are not insufficient')
  const empty = list({ activeWalletId: 'lnbits', balances: { 'spark-biz': 0, 'spark-personal': 0, nwc: 0, lnbits: 0, arkade: 0 }, amountSats: 1 })
  assert.equal(usableIds(empty).length, 0)
  assert.equal(pickDefaultPayingWallet(empty).id, 'lnbits')
  assert.equal(pickDefaultPayingWallet(empty).reason, 'insufficient-balance')
})

test('default pick: null for nothing, and for no active wallet with nothing usable', () => {
  assert.equal(pickDefaultPayingWallet([]), null)
  assert.equal(pickDefaultPayingWallet(null), null)
  assert.equal(pickDefaultPayingWallet(undefined), null)
  const none = listPayingWallets({ wallets: [{ id: 'a', type: 'arkade' }], activeWalletId: null })
  assert.equal(pickDefaultPayingWallet(none), null)
  // ... but with no active wallet and a usable one, that one wins.
  const some = listPayingWallets({ wallets: [{ id: 'a', type: 'arkade' }, { id: 'n', type: 'nwc' }], activeWalletId: null })
  assert.equal(pickDefaultPayingWallet(some).id, 'n')
})

test('a single wallet is its own default, usable or not', () => {
  const only = listPayingWallets({ wallets: [{ id: 'a', type: 'arkade' }], activeWalletId: 'a' })
  assert.equal(only.length, 1)
  assert.equal(pickDefaultPayingWallet(only).id, 'a')
  assert.equal(only[0].usable, false)
})

test('known-fee reserve: zero-fee rails hold nothing back, others only the known fee', () => {
  assert.equal(knownFeeReserveSats('spark_address', 50), 0)
  assert.equal(knownFeeReserveSats('spark', 50), 0)
  assert.equal(knownFeeReserveSats('arkade_address', 50), 0)
  assert.equal(knownFeeReserveSats('lightning_invoice', 7), 7)
  assert.equal(knownFeeReserveSats('lightning_invoice', 6.2), 7)
  assert.equal(knownFeeReserveSats('lightning_address', null), 0)
  assert.equal(knownFeeReserveSats('lnurl'), 0)
  assert.equal(knownFeeReserveSats('bitcoin_address', undefined), 0)
  assert.equal(knownFeeReserveSats('lightning_invoice', -3), 0)
  assert.equal(knownFeeReserveSats('lightning_invoice', NaN), 0)
})

test('reason text is plain: the payment screen never names the rail', () => {
  assert.equal(payingWalletReasonText('unsupported-destination', t), "Can't pay this")
  assert.equal(payingWalletReasonText('insufficient-balance', t), 'Not enough balance')
  assert.equal(payingWalletReasonText(null, t), '')
  assert.equal(payingWalletReasonText(undefined, t), '')
})

test('the banner hint keeps the shared switch words for rail problems', () => {
  const rail = { name: 'Arkade', reason: 'unsupported-destination' }
  assert.equal(payingWalletHint(rail, 'lightning_invoice', t),
    'Lightning is temporarily unavailable on Arkade - switch to another wallet')
  assert.equal(payingWalletHint({ name: 'Alby', reason: 'unsupported-destination' }, 'spark_address', t),
    'Switch to your Spark wallet to pay this address')
  assert.equal(payingWalletHint({ name: 'Business', reason: 'insufficient-balance' }, 'lightning_invoice', t),
    'Not enough balance in Business. Choose another wallet or send less.')
  // No other wallet can pay: no suggestion that leads nowhere.
  assert.equal(payingWalletHint({ name: '', reason: 'insufficient-balance' }, 'lightning_invoice', t, { hasAlternative: false }),
    'Not enough balance in Wallet.')
  assert.equal(payingWalletHint({ name: 'Alby', reason: null }, 'lightning_invoice', t), '')
  assert.equal(payingWalletHint(null, 'lightning_invoice', t), '')
})

test('blocked text: empty when a wallet can pay, else the one sentence that is true', () => {
  const only = (ids, overrides = {}) => list({ wallets: WALLETS.filter((w) => ids.includes(w.id)), ...overrides })
  const short = { amountSats: 60_000 }

  assert.equal(payingBlockedText(list({ amountSats: 1_000 }), t), '')
  assert.equal(payingBlockedText(only(['arkade', 'nwc']), t), '', 'another wallet can pay')
  assert.equal(payingBlockedText([], t), 'You have no wallet to pay with.')
  assert.equal(payingBlockedText(null, t), 'You have no wallet to pay with.')
  assert.equal(payingBlockedText(only(['nwc'], short), t), 'Not enough balance in Alby Hub.')
  assert.equal(payingBlockedText(only(['nwc', 'lnbits'], short), t), 'Not enough balance in your wallets.')
  // The only wallet that takes this rail is named; the one that never could is not blamed.
  assert.equal(payingBlockedText(only(['nwc', 'arkade'], short), t), 'Not enough balance in Alby Hub.')
  assert.equal(payingBlockedText(only(['arkade']), t), "Arkade can't pay this.")
  assert.equal(payingBlockedText(listPayingWallets({ wallets: [{ id: 'a', name: '', type: 'arkade' }] }), t), "Wallet can't pay this.")
  assert.equal(payingBlockedText(only(['arkade', 'nwc'], { destinationType: 'spark_address' }), t), 'None of your wallets can pay this.')
})

test('request payability: nothing is claimed while the saved wallets load', () => {
  const wallets = list({ wallets: WALLETS.filter((w) => w.id === 'arkade') })
  assert.deepEqual(requestPayability({ hydrated: false, savedStateLoaded: false, wallets: [] }, t), { loading: true, reason: '' })
  assert.deepEqual(requestPayability({ hydrated: true, savedStateLoaded: false, wallets: [] }, t),
    { loading: false, reason: 'Your wallets could not be loaded. Close and reopen BuhoGO.' }, 'a failed load is not "no wallet"')
  assert.deepEqual(requestPayability({ hydrated: true, savedStateLoaded: true, wallets }, t), { loading: false, reason: "Arkade can't pay this." })
  assert.deepEqual(requestPayability({ hydrated: true, savedStateLoaded: true, wallets: list() }, t), { loading: false, reason: '' })
})

test('payingWalletsInStore reads the wallet store the way listPayingWallets is given it', () => {
  const store = {
    wallets: [{ id: 'a', type: 'spark', name: 'A' }, { id: 'b', type: 'nwc', name: 'B' }],
    activeWalletId: 'b',
    balances: { a: { sats: 50_000 }, b: { sats: 10 } },
    connectionStates: {},
  }
  assert.deepEqual(
    payingWalletsInStore(store, 1_000),
    listPayingWallets({ ...store, destinationType: 'lightning', amountSats: 1_000, feeReserve: knownFeeReserveSats('lightning', null) }),
  )
  assert.deepEqual(payingWalletsInStore({}, 1_000), [], 'an empty store has nothing to pay with')
})
