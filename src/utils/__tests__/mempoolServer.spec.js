/**
 * The exchange-rate sheet takes a server address the way people write it
 * and turns it into the API URL the rate service calls. These tests pin
 * that mapping, and the labels the Settings row shows.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/mempoolServer.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  MEMPOOL_DEFAULT_URL,
  MEMPOOL_FALLBACK_URL,
  RETIRED_MEMPOOL_URLS,
  normalizeMempoolUrl,
  mempoolServerLabel,
} from '../mempoolServer.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.log(`  ✗ ${name}`)
    console.log(`    ${err.message}`)
    failed += 1
  }
}

console.log('mempoolServer')

test('a bare host gets https:// and /api/v1', () => {
  assert.equal(normalizeMempoolUrl('node.example.com'), 'https://node.example.com/api/v1')
  assert.equal(normalizeMempoolUrl('  node.example.com/  '), 'https://node.example.com/api/v1')
})

test('a full API URL stays as it is, without a trailing slash', () => {
  assert.equal(normalizeMempoolUrl('https://node.example.com/api/v1'), 'https://node.example.com/api/v1')
  assert.equal(normalizeMempoolUrl('https://node.example.com/api/v1/'), 'https://node.example.com/api/v1')
})

test('a path ending in /api only gains /v1', () => {
  assert.equal(normalizeMempoolUrl('https://node.example.com/api'), 'https://node.example.com/api/v1')
})

test('a server under a path keeps it', () => {
  assert.equal(normalizeMempoolUrl('example.com/mempool'), 'https://example.com/mempool/api/v1')
})

test('http and a port stay allowed for a server on the local network', () => {
  assert.equal(normalizeMempoolUrl('http://192.168.1.20:8999'), 'http://192.168.1.20:8999/api/v1')
  assert.equal(normalizeMempoolUrl('localhost:8999'), 'https://localhost:8999/api/v1')
})

test('text that is not a server address gives null', () => {
  for (const input of ['', '   ', 'mempool', 'ftp://node.example.com', 'https://', 'node.example.com/?x=1', 'node .example.com']) {
    assert.equal(normalizeMempoolUrl(input), null, `${JSON.stringify(input)} was accepted`)
  }
})

test('the built-in servers are already in normalized form', () => {
  for (const url of [MEMPOOL_DEFAULT_URL, MEMPOOL_FALLBACK_URL, ...RETIRED_MEMPOOL_URLS]) {
    assert.equal(normalizeMempoolUrl(url), url)
  }
})

test('the label is the address without scheme or API path', () => {
  assert.equal(mempoolServerLabel(null), 'mempool.space')
  assert.equal(mempoolServerLabel(MEMPOOL_DEFAULT_URL), 'mempool.space')
  assert.equal(mempoolServerLabel('https://node.example.com/api/v1'), 'node.example.com')
  assert.equal(mempoolServerLabel('http://192.168.1.20:8999/api/v1'), '192.168.1.20:8999')
  assert.equal(mempoolServerLabel('https://example.com/mempool/api/v1'), 'example.com/mempool')
})

test('a label typed back in gives the same server', () => {
  for (const url of ['https://node.example.com/api/v1', 'https://example.com/mempool/api/v1']) {
    assert.equal(normalizeMempoolUrl(mempoolServerLabel(url)), url)
  }
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
