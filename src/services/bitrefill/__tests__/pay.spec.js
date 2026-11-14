import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const { code } = transformSync(readFileSync(new URL('../pay.js', import.meta.url), 'utf8'), { format: 'cjs' })
const module = { exports: {} }
const deps = {
  '../../utils/internalTransferDetails.js': { internalTransferTransactionId: () => 'tx' },
  '../../stores/transactionMetadata.js': { useTransactionMetadataStore: () => ({ async setLabelForTransaction() {} }) },
}
new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports)
const { payBitrefillInvoice, BITREFILL_PRICE_EXPIRED } = module.exports

test('an expired price is checked after wallet connection and before provider payment', async () => {
  let connected = false
  let sent = false
  const store = {
    wallets: [{ id: 'wallet', type: 'spark' }],
    async ensureWalletConnectedForTransfer() {
      await Promise.resolve()
      connected = true
      return { async payInvoice() { sent = true } }
    },
  }
  await assert.rejects(() => payBitrefillInvoice(store, 'wallet', 'lnbc1testing', { expiresAt: Math.floor(Date.now() / 1000) - 1 }), error => error.code === BITREFILL_PRICE_EXPIRED)
  assert.equal(connected, true)
  assert.equal(sent, false)
})

test('a balance refresh failure cannot turn a successful payment into an error', async () => {
  const result = { id: 'tx', status: 'completed' }
  const store = {
    wallets: [{ id: 'wallet', type: 'spark' }],
    async ensureWalletConnectedForTransfer() { return { async payInvoice() { return result } } },
    refreshWalletData() { throw new Error('refresh unavailable') },
  }
  assert.equal(await payBitrefillInvoice(store, 'wallet', 'lnbc1testing'), result)
})
