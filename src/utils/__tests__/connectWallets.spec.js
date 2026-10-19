/**
 * utils/connectWallets: every wallet "Connect a wallet" offers is complete,
 * so adding one is an entry, a logo and its strings, and this spec says
 * what is missing.
 *
 *   node --test src/utils/__tests__/connectWallets.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import {
  CODE_RELAYS, CONNECT_WALLETS, PAIRING, availableWallets, connectWallet,
  pairsByApproval, upcomingWallets,
} from '../connectWallets.js';
import en from '../../i18n/en-US/index.js';
import de from '../../i18n/de/index.js';
import es from '../../i18n/es/index.js';

const LOCALES = { 'en-US': en, de, es };
const HEX_64 = /^[a-f0-9]{64}$/;
const publicFile = (path) => new URL(`../../../public${path}`, import.meta.url);

/** Every string of an entry that is shown through $t. */
function stringsOf(wallet) {
  const approval = wallet.approval || {};
  return [wallet.nameKey, wallet.subtitle, wallet.about, approval.locationLabel, approval.ownLabel,
    approval.ownHint, approval.note, approval.scanLabel].filter(Boolean);
}

test('ids are unique and every wallet has a name and a mark', () => {
  const ids = CONNECT_WALLETS.map((wallet) => wallet.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const wallet of CONNECT_WALLETS) {
    assert.ok(wallet.name || wallet.nameKey, `${wallet.id}: name or nameKey`);
    assert.ok(wallet.logo || wallet.icon, `${wallet.id}: logo or icon`);
    if (wallet.logo) assert.ok(existsSync(publicFile(wallet.logo)), `${wallet.id}: ${wallet.logo} is in public/`);
  }
});

test('every string is in all three locales', () => {
  for (const wallet of CONNECT_WALLETS) {
    for (const key of stringsOf(wallet)) {
      for (const [locale, messages] of Object.entries(LOCALES)) {
        assert.ok(key in messages, `${wallet.id}: "${key}" missing in ${locale}`);
      }
    }
  }
});

test('a choice says how it pairs; a wallet on its way says what it is', () => {
  const ways = Object.values(PAIRING);
  for (const wallet of availableWallets()) {
    assert.ok(ways.includes(wallet.pairing), `${wallet.id}: pairing`);
    assert.ok(wallet.subtitle, `${wallet.id}: subtitle`);
    if (wallet.pairing === PAIRING.SHEET) assert.match(wallet.route, /^\//, `${wallet.id}: route`);
  }
  for (const wallet of upcomingWallets()) {
    assert.ok(wallet.about, `${wallet.id}: about`);
    assert.equal(wallet.pairing, undefined, `${wallet.id}: not a choice yet`);
  }
  assert.equal(availableWallets().filter((wallet) => wallet.pairing === PAIRING.MANUAL).length, 1, 'one manual way');
});

test('an approval page is described completely', () => {
  for (const wallet of CONNECT_WALLETS.filter(pairsByApproval)) {
    const { approval } = wallet;
    assert.match(approval.path, /^\//, `${wallet.id}: path`);
    assert.ok(approval.note, `${wallet.id}: note`);
    const places = [approval.url, ...(approval.locations || []).map((place) => place.url)].filter(Boolean);
    assert.ok(places.length || approval.selfHosted, `${wallet.id}: somewhere to open`);
    for (const url of places) assert.match(url, /^https:\/\/[^/\s]+$/, `${wallet.id}: ${url} is an https origin`);
    for (const place of approval.locations || []) assert.ok(place.id && place.name, `${wallet.id}: location id and name`);
    if (approval.locations?.length || approval.selfHosted) assert.ok(approval.locationLabel, `${wallet.id}: locationLabel`);
    if (approval.selfHosted) assert.ok(approval.ownLabel && approval.ownHint, `${wallet.id}: own address labels`);
    if (wallet.pairing === PAIRING.APPROVE_AND_RETURN) {
      assert.ok(approval.relays?.length, `${wallet.id}: relays it announces on`);
      for (const relay of approval.relays) assert.match(relay, /^wss:\/\//);
    }
    if (wallet.pairing === PAIRING.APPROVE_KNOWN) {
      assert.match(approval.walletPubkey, HEX_64, `${wallet.id}: wallet key`);
      assert.match(approval.relay, /^wss:\/\//, `${wallet.id}: relay`);
    }
  }
});

test('lookups', () => {
  assert.equal(connectWallet('albyhub').name, 'Alby Hub');
  assert.equal(connectWallet('nope'), null);
  assert.ok(CODE_RELAYS.every((relay) => relay.startsWith('wss://')));
  assert.deepEqual(upcomingWallets().map((wallet) => wallet.id), ['buhohub']);
});
