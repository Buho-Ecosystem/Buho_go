/**
 * lightningAddressNames — random Lightning-address generation.
 *
 * Coverage focus:
 *   - every word in both lists is lowercase a-z (usernames are valid by
 *     construction) and the worst-case combination stays under the
 *     32-character username ceiling
 *   - generated names follow {adjective}{animal}{3 digits}
 *   - registerRandomLightningAddress retries on collision, retries on a
 *     failed attempt, returns the registered address, and gives up with
 *     the last error after max attempts
 *
 * Run directly with Node:
 *   node src/utils/__tests__/lightningAddressNames.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  generateRandomUsername,
  registerRandomLightningAddress,
  _wordlists,
} from '../lightningAddressNames.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed += 1;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed += 1;
    });
}

const USERNAME_RE = /^[a-z0-9]{3,32}$/;

console.log('lightningAddressNames');

await test('word lists contain only lowercase a-z', () => {
  for (const list of [_wordlists.ADJECTIVES, _wordlists.ANIMALS]) {
    for (const word of list) {
      assert.match(word, /^[a-z]+$/, `bad word: "${word}"`);
    }
  }
});

await test('worst-case combination stays under the 32-char ceiling', () => {
  const longest = (list) => Math.max(...list.map((w) => w.length));
  const max = longest(_wordlists.ADJECTIVES) + longest(_wordlists.ANIMALS) + 3;
  assert.ok(max <= 32, `longest possible username is ${max} chars`);
});

await test('generated names follow {adjective}{animal}{3 digits} and validate', () => {
  for (let i = 0; i < 500; i++) {
    const name = generateRandomUsername();
    assert.match(name, /^[a-z]+\d{3}$/, name);
    assert.match(name, USERNAME_RE, name);
  }
});

await test('collision retries with a fresh name and returns the address', async () => {
  const tried = [];
  const provider = {
    async checkLightningAddressAvailable(username) {
      tried.push(username);
      return tried.length >= 3; // first two read taken
    },
    async registerLightningAddress(username) {
      return { lightningAddress: `${username}@btc.mybuho.de` };
    },
  };
  const address = await registerRandomLightningAddress(provider);
  assert.equal(tried.length, 3);
  assert.equal(new Set(tried).size, 3, 'each retry must mint a fresh name');
  assert.equal(address, `${tried[2]}@btc.mybuho.de`);
});

await test('a failed registration attempt retries instead of aborting', async () => {
  let registerCalls = 0;
  const provider = {
    async checkLightningAddressAvailable() { return true; },
    async registerLightningAddress(username) {
      registerCalls += 1;
      if (registerCalls === 1) throw new Error('transient server error');
      return { lightningAddress: `${username}@btc.mybuho.de` };
    },
  };
  const address = await registerRandomLightningAddress(provider);
  assert.equal(registerCalls, 2);
  assert.match(address, /@btc\.mybuho\.de$/);
});

await test('gives up with the last error after max attempts', async () => {
  const provider = {
    async checkLightningAddressAvailable() { return true; },
    async registerLightningAddress() { throw new Error('registration rejected'); },
  };
  await assert.rejects(
    () => registerRandomLightningAddress(provider, { maxAttempts: 3 }),
    /registration rejected/
  );
});

await test('exhausting collisions rejects instead of resolving empty', async () => {
  const provider = {
    async checkLightningAddressAvailable() { return false; },
    async registerLightningAddress() { throw new Error('never reached'); },
  };
  await assert.rejects(() => registerRandomLightningAddress(provider, { maxAttempts: 2 }));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
