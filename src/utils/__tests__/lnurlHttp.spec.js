/**
 * lnurlHttp — CORS-safe transport for LNURL rails.
 *
 * Under Node there is no Capacitor native platform, so these tests
 * exercise the web-fetch branch (the same one the browser build uses)
 * by stubbing global fetch, plus the JSON/error normalization that both
 * branches share.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/lnurlHttp.spec.js
 */
import { strict as assert } from 'node:assert'
import { lnurlFetch, lnurlGetJson } from '../lnurlHttp.js'

const tests = []
function test(name, fn) { tests.push([name, fn]) }

const realFetch = globalThis.fetch
function stubFetch(impl) { globalThis.fetch = impl }
function restoreFetch() { globalThis.fetch = realFetch }

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(JSON.stringify(body)),
  }
}

// ── lnurlGetJson ───────────────────────────────────────────────────────────

test('lnurlGetJson returns parsed data on a 200 JSON response', async () => {
  stubFetch(async (url, opts) => {
    assert.equal(url, 'https://pay.example/.well-known/lnurlp/jens')
    assert.equal(opts.headers.Accept, 'application/json')
    assert.ok(opts.signal, 'passes an abort signal for its timeout')
    return jsonResponse({ tag: 'payRequest', minSendable: 1000, callback: 'https://pay.example/cb' })
  })
  try {
    const r = await lnurlGetJson('https://pay.example/.well-known/lnurlp/jens')
    assert.equal(r.ok, true)
    assert.equal(r.status, 200)
    assert.equal(r.data.tag, 'payRequest')
    assert.equal(r.data.minSendable, 1000)
  } finally { restoreFetch() }
})

test('lnurlGetJson resolves (ok:false) on HTTP error statuses, like fetch', async () => {
  stubFetch(async () => jsonResponse({ status: 'ERROR', reason: 'nope' }, 403))
  try {
    const r = await lnurlGetJson('https://pay.example/x')
    assert.equal(r.ok, false)
    assert.equal(r.status, 403)
    assert.equal(r.data.reason, 'nope')
  } finally { restoreFetch() }
})

test('lnurlGetJson yields data:null on an unreadable body instead of throwing', async () => {
  stubFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }))
  try {
    const r = await lnurlGetJson('https://pay.example/x')
    assert.equal(r.ok, true)
    assert.equal(r.data, null)
  } finally { restoreFetch() }
})

test('lnurlGetJson nulls a non-object JSON body (e.g. a bare string)', async () => {
  stubFetch(async () => ({ ok: true, status: 200, json: async () => 'oops' }))
  try {
    const r = await lnurlGetJson('https://pay.example/x')
    assert.equal(r.data, null)
  } finally { restoreFetch() }
})

test('lnurlGetJson rethrows transport failures untouched', async () => {
  stubFetch(async () => { throw new TypeError('Failed to fetch') })
  try {
    await assert.rejects(
      () => lnurlGetJson('https://pay.example/x'),
      (err) => err instanceof TypeError && err.message === 'Failed to fetch',
    )
  } finally { restoreFetch() }
})

test('lnurlGetJson maps its timeout abort to a named AbortError with stable copy', async () => {
  stubFetch((url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('This operation was aborted')
      e.name = 'AbortError'
      reject(e)
    })
  }))
  try {
    await assert.rejects(
      () => lnurlGetJson('https://pay.example/slow', { timeoutMs: 20 }),
      (err) => err.name === 'AbortError' && err.message === 'The server did not respond in time',
    )
  } finally { restoreFetch() }
})

test('lnurlGetJson leaves the LUD-06 ERROR envelope for the caller to interpret', async () => {
  stubFetch(async () => jsonResponse({ status: 'ERROR', reason: 'Route not found' }))
  try {
    const r = await lnurlGetJson('https://pay.example/cb?amount=1000')
    assert.equal(r.ok, true)
    assert.equal(r.data.status, 'ERROR')
    assert.equal(r.data.reason, 'Route not found')
  } finally { restoreFetch() }
})

// ── lnurlFetch (the pollVerify fetchImpl surface) ──────────────────────────

test('lnurlFetch is fetch-compatible on web: passes signal, returns the Response', async () => {
  const marker = jsonResponse({ settled: true })
  let seenSignal = null
  stubFetch(async (url, opts) => { seenSignal = opts.signal; return marker })
  try {
    const controller = new AbortController()
    const r = await lnurlFetch('https://pay.example/verify/1', { signal: controller.signal })
    assert.equal(r, marker)
    assert.equal(seenSignal, controller.signal)
    assert.equal((await r.json()).settled, true)
  } finally { restoreFetch() }
})

test('lnurlFetch omits signal cleanly when none is given', async () => {
  stubFetch(async (url, opts) => {
    assert.equal(opts.signal, undefined)
    return jsonResponse({})
  })
  try {
    const r = await lnurlFetch('https://pay.example/x')
    assert.equal(r.ok, true)
  } finally { restoreFetch() }
})

;(async () => {
  let passed = 0
  let failed = 0
  for (const [name, fn] of tests) {
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
  console.log(`\n  ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})()
