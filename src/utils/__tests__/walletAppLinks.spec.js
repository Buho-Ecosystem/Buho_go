/**
 * utils/walletAppLinks: the wallets "Pay from another wallet" can open where
 * the system can't list them, kept in step with Info.plist, the manifest and
 * the logos it ships.
 *
 *   node --test src/utils/__tests__/walletAppLinks.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { LINK_FORM, MAX_QUERIED_SCHEMES, QUERIED_SCHEMES, WALLET_APP_LINKS, detectionLinks, requestKind, walletAppLink } from '../walletAppLinks.js';

const root = new URL('../../../', import.meta.url);
const plist = readFileSync(new URL('src-capacitor/ios/App/App/Info.plist', root), 'utf8');
const manifest = readFileSync(new URL('src-capacitor/android/app/src/main/AndroidManifest.xml', root), 'utf8');

function queriedSchemes() {
  const block = plist.match(/<key>LSApplicationQueriesSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/);
  assert.ok(block, 'Info.plist lists LSApplicationQueriesSchemes');
  return [...block[1].matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]);
}

test('every wallet scheme is in Info.plist, and no other, within the system limit', () => {
  const schemes = queriedSchemes();
  assert.deepEqual([...schemes].sort(), [...QUERIED_SCHEMES].sort());
  assert.ok(schemes.length <= MAX_QUERIED_SCHEMES, `at most ${MAX_QUERIED_SCHEMES} (source: docs/PAY_FROM_ANOTHER_WALLET.md)`);
});

test('each wallet is complete, once, with its logo shipped', () => {
  const ids = new Set();
  const schemes = new Set();
  for (const wallet of WALLET_APP_LINKS) {
    assert.ok(wallet.id && wallet.name, wallet.id);
    const own = wallet.detect ?? [wallet.scheme];
    assert.ok(!ids.has(wallet.id) && own.every((scheme) => !schemes.has(scheme)), `${wallet.id} listed once`);
    ids.add(wallet.id);
    own.forEach((scheme) => schemes.add(scheme));
    for (const scheme of own) {
      assert.match(scheme, /^[a-z][a-z0-9+.-]*$/, `${wallet.id} scheme`);
      assert.ok(!['lightning', 'bitcoin', 'buhogo'].includes(scheme), `${wallet.id} has its own scheme`);
    }
    assert.ok(Object.values(LINK_FORM).includes(wallet.form), `${wallet.id} form`);
    if (wallet.form === LINK_FORM.WEB) {
      assert.match(wallet.web, /^https:\/\/[^/]+\//, `${wallet.id} web link`);
      assert.ok(wallet.detect?.length, `${wallet.id}: a web link proves nothing, so it names the schemes that reveal it`);
    }
    if (wallet.androidPackage) {
      assert.ok(manifest.includes(`<package android:name="${wallet.androidPackage}" />`), `${wallet.id} package visible on Android`);
    }
    assert.ok(wallet.pays.length && wallet.pays.every((kind) => kind === 'lightning' || kind === 'bitcoin'), `${wallet.id} pays`);
    assert.ok(existsSync(new URL(`public${wallet.logo}`, root)), `${wallet.id} logo at public${wallet.logo}`);
  }
});

test('the request rides whole after the wallet scheme', () => {
  const invoice = 'lightning:lnbc210u1pjexample';
  assert.equal(walletAppLink({ scheme: 'walletofsatoshi', form: LINK_FORM.PREFIX }, invoice), 'walletofsatoshi:lightning:lnbc210u1pjexample');
  assert.equal(walletAppLink({ scheme: 'bitkit', form: LINK_FORM.SLASHES }, ` ${invoice} `), 'bitkit://lightning:lnbc210u1pjexample');
});

test('a bare wallet reads the request under its own scheme in place of the inner one', () => {
  const muun = WALLET_APP_LINKS.find((wallet) => wallet.id === 'muun');
  assert.equal(walletAppLink(muun, 'lightning:lnbc210u1p'), 'muun:lnbc210u1p', 'with the inner scheme kept, it would be read twice');
  assert.equal(walletAppLink(muun, 'bitcoin:bc1q?amount=0.1&lightning=lnbc1'), 'muun:bc1q?amount=0.1&lightning=lnbc1');
  const blink = WALLET_APP_LINKS.find((wallet) => wallet.id === 'blink');
  assert.equal(walletAppLink(blink, 'LIGHTNING:lnbc210u1p'), 'blink:lnbc210u1p');
  assert.deepEqual(blink.pays, ['lightning'], 'a wallet that reads a bare invoice only pays invoices only');
  const cake = WALLET_APP_LINKS.find((wallet) => wallet.id === 'cake-wallet');
  assert.equal(walletAppLink(cake, 'bitcoin:bc1qx?amount=0.0002'), 'cakewallet:bc1qx?amount=0.0002', 'with the inner scheme kept, it would become part of the address');
  assert.equal(walletAppLink(cake, 'lightning:lnbc210u1p'), 'cakewallet:lnbc210u1p', 'the invoice and its amount ride bare');
  assert.deepEqual(cake.pays, ['lightning', 'bitcoin'], 'pays invoices and Bitcoin requests');
  const river = WALLET_APP_LINKS.find((wallet) => wallet.id === 'river');
  assert.equal(walletAppLink(river, 'lightning:lnbc210u1p'), 'river://lnbc210u1p');
});

test('a web-link wallet opens its own web link and is found by its schemes', () => {
  const cashApp = WALLET_APP_LINKS.find((wallet) => wallet.id === 'cash-app');
  assert.equal(walletAppLink(cashApp, 'lightning:lnbc210u1p'), 'https://cash.app/launch/lightning/lnbc210u1p');
  assert.deepEqual(detectionLinks(cashApp, 'lightning:lnbc210u1p'), ['squarecash://', 'cashme://']);
  const phoenix = WALLET_APP_LINKS.find((wallet) => wallet.id === 'phoenix');
  assert.deepEqual(detectionLinks(phoenix, 'lightning:lnbc1'), ['phoenix:lightning:lnbc1'], 'a scheme wallet is found by the link it opens');
});

test('a pay-link wallet gets the request URL-encoded once, nothing lost on the way', () => {
  const coinsnap = WALLET_APP_LINKS.find((wallet) => wallet.id === 'coinsnap');
  const request = 'bitcoin:BC1QEXAMPLE?amount=0.00021&lightning=LNBC210U1P&label=Caf%C3%A9%20%26%20Bar';
  const link = walletAppLink(coinsnap, request);
  assert.equal(link, `coinsnap://pay?request=${encodeURIComponent(request)}`);
  const params = new URL(link).searchParams;
  assert.deepEqual([...params.keys()], ['request']);
  assert.equal(params.get('request'), request, 'one decode gives back the request, its own escapes intact');
});

test('every link form is spelled out; an unknown one is a catalog error, not a guess', () => {
  assert.throws(() => walletAppLink({ scheme: 'x', form: 'nope' }, 'lightning:lnbc1'), /Unknown link form/);
});

test('only lightning: and bitcoin: requests are handed to another wallet', () => {
  assert.equal(requestKind('lightning:lnbc1'), 'lightning');
  assert.equal(requestKind('LIGHTNING:LNBC1'), 'lightning');
  assert.equal(requestKind('bitcoin:bc1q?amount=0.1'), 'bitcoin');
  assert.equal(requestKind('lnbc1'), null);
  assert.equal(requestKind('buhogo://pay?request=x'), null);
  assert.equal(requestKind(''), null);
  assert.equal(requestKind(undefined), null);
});
