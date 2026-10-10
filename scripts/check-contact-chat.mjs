// End-to-end check of the contact chat: two real app instances (Alice and Bob, two browser
// contexts) talk NIP-17 through one simulated relay. Run against `pnpm dev --port 9012`
// (or set CONTACT_CHAT_BASE_URL). Never touches a real relay, wallet or network:
//   - every wss:// connection goes to SimRelay (scripts/fixtures/contactChat.mjs); the
//     `auth.nostr1.com` URL demands NIP-42 AUTH for kind 1059 like the real relay
//   - wallets are scripted at the wallet-store level (the way check-transfer-completion does);
//     invoices come from a shared InvoiceLedger so Bob "paying" Alice's invoice is visible to her
//   - all HTTP except the app itself, the price API stub and the icon CDN is aborted
// Screenshots (light and dark per step, de/es/large text at the end): CONTACT_CHAT_OUTPUT.
import { chromium } from '@playwright/test';
import { finalizeEvent } from 'nostr-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { deriveNostrIdentity } from '../src/utils/identityCrypto.js';
import { DM_INBOX_RELAYS } from '../src/services/dm/constants.js';
import { buildRequestTemplate, buildTextTemplate } from '../src/services/dm/protocol.js';
import { sealAndWrap } from '../src/services/dm/giftWrap.js';
import { InvoiceLedger, SimRelay } from './fixtures/contactChat.mjs';

const base = process.env.CONTACT_CHAT_BASE_URL || 'http://localhost:9012';
const output = process.env.CONTACT_CHAT_OUTPUT || 'output/contact-chat';
const AUTH_HOST = 'auth.nostr1.com';
await mkdir(output, { recursive: true });

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

const person = (name, mnemonic) => {
  const keys = deriveNostrIdentity(mnemonic);
  return { name, mnemonic, secretKey: keys.privateKey, pubkey: keys.publicKeyHex, npub: keys.npub };
};
const ALICE = person('Alice', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const BOB = person('Bob', 'legal winner thank year wave sausage worth useful legal winner thank yellow');
const CAROL = person('Carol', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above');
const DAVE = person('Dave', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong');

/** A signed kind 0, the way the address book stores a Nostr contact. */
const profileOf = (who) => finalizeEvent(
  { kind: 0, created_at: 1790000000, tags: [], content: JSON.stringify({ name: who.name }) },
  who.secretKey,
);

const relay = new SimRelay();
const ledger = new InvoiceLedger();

// Wallets, described once and built inside the page (see `seedWallets`).
const ALICE_WALLETS = [
  { id: 'alice-spark', type: 'spark', name: 'Business', balance: 5000 },
  { id: 'alice-lnbits', type: 'lnbits', name: 'Shop', balance: 0 },
  { id: 'alice-nwc', type: 'nwc', name: 'Alby Hub', balance: 0 },
  { id: 'alice-arkade', type: 'arkade', name: 'Ark', balance: 0 },
];
const BOB_WALLETS = [
  { id: 'bob-spark', type: 'spark', name: 'Personal', balance: 50000 },
  { id: 'bob-nwc', type: 'nwc', name: 'Alby Hub', balance: 40000 },
  { id: 'bob-lnbits', type: 'lnbits', name: 'Shop', balance: 30000 },
  { id: 'bob-arkade', type: 'arkade', name: 'Ark', balance: 20000 },
];

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const actors = {};
const pageErrors = [];
let currentStep = 'startup';
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function step(title, run) {
  currentStep = title;
  await run();
  console.log(`  ok  ${title}`);
}

async function saveFailureShots() {
  for (const [name, actor] of Object.entries(actors)) {
    await actor.page.screenshot({ path: `${output}/FAIL-${slug(currentStep)}-${name}.png` }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Browser setup
// ---------------------------------------------------------------------------

async function launchUser(browser, who) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  context.setDefaultTimeout(15000);

  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') {
      return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
    }
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    return route.abort();
  });
  await context.routeWebSocket(/.*/, (socket) => {
    if (new URL(socket.url()).host === new URL(base).host) return socket.connectToServer();
    const connection = relay.attach(socket.url(), (frame) => { try { socket.send(JSON.stringify(frame)); } catch { /* closed */ } });
    socket.onMessage((raw) => connection.onMessage(String(raw)));
    socket.onClose(() => connection.onClose());
  });

  // The wallets' network edge: what the stubbed providers call (see `seedWallets`).
  await context.exposeFunction('__e2eMintInvoice', (amountSats) => ledger.mint({ amountSats }));
  await context.exposeFunction('__e2eLookupInvoice', (hash) => ledger.lookup(hash));
  await context.exposeFunction('__e2ePayInvoice', (bolt11) => ledger.pay(bolt11));

  await context.addInitScript(() => {
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buho.theme', 'light');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${who.name} during "${currentStep}": ${error.message}\n${String(error.stack).split('\n').slice(1, 4).join('\n')}`));
  return { who, context, page };
}

/** Identity, address-book contacts and wallets, written through the app's own stores. */
async function seedUser(actor, { contacts, wallets }) {
  const { page, who } = actor;
  await page.goto(`${base}/#/address-book`);
  await page.locator('.add-contact-btn').waitFor();
  await page.evaluate(async ({ mnemonic, contactData }) => {
    const { useIdentityStore } = await import('/src/stores/identity.js');
    const { useAddressBookStore } = await import('/src/stores/addressBook.js');
    await useIdentityStore().importMnemonic(mnemonic, true);
    const book = useAddressBookStore();
    await book.initialize();
    for (const contact of contactData) await book.addNostrContact({ ...contact, allowWithoutLightningAddress: true });
  }, {
    mnemonic: who.mnemonic,
    contactData: contacts.map((c) => ({ pubkey: c.pubkey, npub: c.npub, event: profileOf(c) })),
  });
  await seedWallets(actor, wallets);
}

/**
 * Scripted wallets at the store level: connected providers whose invoices come from the shared
 * ledger. `payInvoice` marks the ledger so the receiver's `lookupInvoice` reports it paid.
 */
async function seedWallets({ page }, wallets) {
  await page.evaluate(async (specs) => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const store = useWalletStore();
    const makeProvider = (spec) => ({
      isConnected: true,
      getBalance: async () => spec.balance,
      getTransactions: async () => [],
      getSparkAddress: async () => `${spec.id}-spark-address`,
      createInvoice: async ({ amount }) => {
        const { bolt11, paymentHash } = await window.__e2eMintInvoice(amount);
        return { paymentRequest: bolt11, paymentHash };
      },
      lookupInvoice: async (hash) => window.__e2eLookupInvoice(hash),
      onPaymentReceived: () => () => {},
      getLightningSendFeeEstimate: async () => 0,
      payInvoice: async ({ invoice }) => {
        const preimage = await window.__e2ePayInvoice(invoice);
        window.__e2ePayments = [...(window.__e2ePayments || []), { walletId: spec.id, invoice }];
        return { id: `payment-${spec.id}`, preimage, status: 'completed', fee: 0 };
      },
    });
    store.wallets = specs.map(({ id, type, name }) => ({ id, type, name, ...(type === 'nwc' ? { nwcString: 'nostr+walletconnect://stub' } : {}) }));
    store.activeWalletId = specs[0].id;
    store.connectionStates = Object.fromEntries(specs.map((spec) => [spec.id, { connected: true }]));
    store.providers = {};
    for (const spec of specs) {
      const provider = makeProvider(spec);
      if (spec.type === 'nwc') store.connectionStates[spec.id].nwcInstance = provider;
      else store.providers[spec.id] = provider;
      store.applyBalance(spec.id, spec.balance);
    }
    const providerOf = async (id) => store.getProvider(id || store.activeWalletId);
    store.ensureWalletConnectedForTransfer = providerOf;
    store.ensureSparkConnected = providerOf;
    store.ensureLNBitsConnected = providerOf;
    store.ensureArkadeConnected = providerOf;
    store.refreshWalletData = async () => {};
    store.connectAllSparkWallets = async () => {};
  }, wallets);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const setTheme = (page, dark) => page.evaluate((value) => {
  document.querySelector('#q-app').__vue_app__.config.globalProperties.$q.dark.set(value);
}, dark);

// Through the root component's `$i18n`: a dynamic import of the i18n boot file can resolve to a
// second module instance under Vite's HMR timestamps, which would change nothing on screen.
const setLocale = (page, locale) => page.evaluate((value) => {
  document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n.locale = value;
}, locale);

/** Screenshot in light and dark, leaving the page light. */
async function snap({ page, who }, name) {
  for (const dark of [false, true]) {
    await setTheme(page, dark);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/${slug(`${name}-${who.name}`)}-${dark ? 'dark' : 'light'}.png` });
  }
  await setTheme(page, false);
}

/**
 * In-app navigation. A page load would drop the scripted wallets (they live in the store, not
 * in storage), so every move after the first load goes through the router.
 */
const navigate = (page, path) => page.evaluate((target) => {
  document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push(target);
}, path);

/** Open the chat with a contact by tapping its row in the address book. */
async function openChatFromAddressBook({ page }, name) {
  await navigate(page, '/address-book');
  await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
  await page.locator('.chat-header').waitFor();
}

const chatCard = (page, pattern) => page.getByRole('group', { name: pattern });
const messageBubble = (page, text) => page.locator('.bubble-row').filter({ hasText: text });

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

const browser = await chromium.launch({ headless: true });
try {
  actors.alice = await launchUser(browser, ALICE);
  actors.bob = await launchUser(browser, BOB);
  const { alice, bob } = actors;

  console.log('1. Start, inbox lists, open the chat');
  await step('both users start with each other as Nostr contact', async () => {
    await seedUser(alice, { contacts: [BOB, DAVE], wallets: ALICE_WALLETS });
    await seedUser(bob, { contacts: [ALICE], wallets: BOB_WALLETS });
  });

  await step('each publishes a kind 10050 naming the inbox relays', async () => {
    for (const who of [ALICE, BOB]) {
      const event = await relay.waitFor({ kind: 10050, pubkey: who.pubkey }, `10050 of ${who.name}`);
      const urls = event.tags.filter((tag) => tag[0] === 'relay').map((tag) => new URL(tag[1]).host);
      assert.deepEqual(urls.sort(), DM_INBOX_RELAYS.map((url) => new URL(url).host).sort());
    }
  });

  await step('Alice opens the chat from the address book; header says encrypted', async () => {
    await openChatFromAddressBook(alice, 'Bob');
    await alice.page.getByText('End-to-end encrypted', { exact: true }).waitFor();
    await alice.page.getByRole('button', { name: 'Write a message' }).waitFor();
    assert.equal(await alice.page.getByText('Payments only', { exact: true }).count(), 0);
    await snap(alice, '01-chat-empty');
  });

  await step('the inbox was read after NIP-42 AUTH with the identity', async () => {
    await expectAuth(ALICE);
    await expectAuth(BOB);
    assert.deepEqual(relay.log.authRefusals.filter((r) => r.host !== AUTH_HOST), []);
  });

  console.log('2. Text, badges, delivery, reply, reaction');
  await step('Alice sends a text; it shows "Sent"', async () => {
    await alice.page.getByRole('button', { name: 'Write a message' }).click();
    await alice.page.getByRole('textbox', { name: 'Message' }).fill('Hello Bob');
    await alice.page.getByRole('button', { name: 'Send message' }).click();
    await messageBubble(alice.page, 'Hello Bob').getByRole('status').filter({ hasText: 'Sent' }).waitFor();
  });

  await step('Bob sees a badge in the address book and in the menu, then the message', async () => {
    await navigate(bob.page, '/address-book');
    await bob.page.getByRole('button', { name: 'Alice, New messages: 1' }).waitFor();
    await snap(bob, '02-address-book-badge');
    await navigate(bob.page, '/wallet');
    await bob.page.getByRole('button', { name: /Address Book|Menu/ }).first().waitFor();
    await openMenuBadge(bob.page);
    await navigate(bob.page, '/address-book');
    await bob.page.getByRole('button', { name: 'Alice, New messages: 1' }).click();
    await messageBubble(bob.page, 'Hello Bob').waitFor();
    assert.equal(await bob.page.getByRole('button', { name: /Alice, New messages/ }).count(), 0);
  });

  await step('Bob replies and reacts; Alice sees both', async () => {
    await bob.page.getByRole('button', { name: 'Write a message' }).click();
    await bob.page.getByRole('textbox', { name: 'Message' }).fill('Hi Alice');
    await bob.page.getByRole('button', { name: 'Send message' }).click();
    await messageBubble(alice.page, 'Hi Alice').waitFor();

    await messageBubble(bob.page, 'Hello Bob').locator('.bubble').click({ button: 'right' });
    await bob.page.getByRole('button', { name: 'React with 👍' }).click();
    await alice.page.getByRole('group', { name: 'Reactions' }).getByRole('button', { name: /👍/ }).waitFor();
    await snap(alice, '03-thread-text');
  });

  console.log('3 + 6. Requests, payments and the paying-wallet matrix');
  await step('Alice requests 1,000 sats "Pizza"; Bob sees a card without an invoice-amount row', async () => {
    await requestMoney(alice.page, '1000', 'Pizza');
    await chatCard(alice.page, /^You requested/).getByRole('button', { name: 'Withdraw' }).waitFor();
    const card = chatCard(bob.page, /^Alice requests/);
    await card.waitFor();
    await card.getByText('Pizza').waitFor();
    await card.getByRole('button', { name: 'Pay' }).waitFor();
    await card.getByRole('button', { name: 'Decline' }).waitFor();
    assert.equal(await bob.page.getByText(/amount in invoice/i).count(), 0);
    await snap(bob, '04-request-card');
  });

  await step('Bob declines; Alice sees Declined', async () => {
    await chatCard(bob.page, /^Alice requests/).getByRole('button', { name: 'Decline' }).click();
    await chatCard(alice.page, /^You requested/).getByText('Declined', { exact: true }).waitFor();
    await chatCard(bob.page, /^Alice requests/).getByText('Declined', { exact: true }).waitFor();
  });

  await step('Alice receives in Spark; Bob pays from his Spark wallet; both see Paid', async () => {
    await requestMoney(alice.page, '1000', 'Pizza again', { receiveMatrix: true });
    await payRequestFromChat(bob, /^Alice requests.*Pizza again/);
    await payWithOptionsMatrix(bob.page);
    await snap(bob, '05-pay-with');
    await confirmPayment(bob.page);
    await expectPaidFrom(bob, 'bob-spark', 1);
    await chatCard(alice.page, /^You requested.*Pizza again/).getByText('Paid', { exact: true }).waitFor();
    await openChatFromAddressBook(bob, 'Alice');
    await chatCard(bob.page, /^Alice requests.*Pizza again/).getByText('Paid', { exact: true }).waitFor();
    await snap(alice, '06-request-paid');
  });

  await step('Alice receives in LNbits; Bob chooses his LNbits wallet in "Pay with"', async () => {
    await requestMoney(alice.page, '2100', 'Beer', { receiveIn: 'Shop' });
    await payRequestFromChat(bob, /^Alice requests.*Beer/);
    await payWith(bob.page, 'Shop');
    await confirmPayment(bob.page);
    await expectPaidFrom(bob, 'bob-lnbits', 2);
    await chatCard(alice.page, /^You requested.*Beer/).getByText('Paid', { exact: true }).waitFor();
    await openChatFromAddressBook(bob, 'Alice');
    await chatCard(bob.page, /^Alice requests.*Beer/).getByText('Paid', { exact: true }).waitFor();
  });

  console.log('4. Payments only');
  await step('a contact without a 10050 shows "Payments only" and the share-link dialog', async () => {
    await openChatFromAddressBook(alice, 'Dave');
    await alice.page.getByText('Payments only', { exact: true }).waitFor();
    assert.equal(await alice.page.getByRole('button', { name: 'Write a message' }).count(), 0);
    await alice.page.getByRole('button', { name: 'Request' }).click();
    const dialog = alice.page.getByRole('alertdialog', { name: 'Payment request' });
    await dialog.getByText("Dave can't receive requests in the chat yet.").waitFor();
    await dialog.getByRole('button', { name: 'Share payment link' }).waitFor();
    await snap(alice, '07-payments-only-dialog');
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  console.log('5. Unknown sender');
  await step('Carol, not a contact, messages Alice and asks for money', async () => {
    const request = ledger.mint({ amountSats: 2100 });
    await deliverFromCarol(buildTextTemplate({ recipient: ALICE.pubkey, text: 'Hey, it is Carol' }));
    await deliverFromCarol(buildRequestTemplate({ recipient: ALICE.pubkey, amountSats: 2100, bolt11: request.bolt11, note: 'Rent' }));
    await navigate(alice.page, '/address-book');
    await alice.page.getByRole('button', { name: /Message requests/ }).click();
    await alice.page.getByRole('region', { name: 'Messages' }).getByRole('button', { name: /^npub1.*New messages/ }).click();
    await alice.page.getByRole('group', { name: 'Not in your contacts' }).waitFor();
    await alice.page.getByText('Only pay if you are sure who this is.').waitFor();
    await messageBubble(alice.page, 'Hey, it is Carol').waitFor();
    const card = chatCard(alice.page, /requests|Payment request/).first();
    await card.waitFor();
    assert.match(await card.getByRole('button', { name: 'Pay' }).getAttribute('class'), /request-btn--outline/, 'Pay is not the primary action for a stranger');
    assert.equal(await alice.page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true, 'no free-form send to a stranger');
    await snap(alice, '08-unknown-sender');
  });

  console.log('7. Locales (en-US, de, es) and large text, light and dark');
  for (const textSize of ['normal', 'large']) {
    for (const locale of ['en-US', 'de', 'es']) {
      await step(`screens in ${locale}, ${textSize} text: no overflow, screenshots`, async () => {
        const label = `${locale}-${textSize}`;
        await setLocale(bob.page, locale);
        await setLocale(alice.page, locale);
        assert.equal(await bob.page.evaluate(() => document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n.locale), locale);
        for (const { page } of [alice, bob]) {
          await page.evaluate((size) => { document.documentElement.style.fontSize = size === 'large' ? '125%' : ''; }, textSize);
        }

        // Bob's thread: text, a declined and two paid cards.
        await openChatFromAddressBook(bob, 'Alice');
        await bob.page.waitForTimeout(300);
        await assertFits(bob.page, `thread ${label}`);
        await snap(bob, `09-thread-${label}`);

        // Alice's request sheet with the wallet list open.
        await openChatFromAddressBook(alice, 'Bob');
        await alice.page.getByRole('button', { name: /^(Request|Anfordern|Solicitar)$/ }).click();
        await alice.page.getByRole('button', { name: /^(Receive in|Empfangen in|Recibir en)/ }).click();
        await alice.page.waitForTimeout(300);
        await assertFits(alice.page, `request sheet ${label}`);
        await snap(alice, `10-request-sheet-${label}`);
        await alice.page.getByRole('button', { name: /^(Close|Schlie\u00dfen|Cerrar)$/ }).click();

        // The stranger's chat: banner, an untrusted request, then its confirm sheet.
        await navigate(alice.page, `/messages/${CAROL.pubkey}`);
        await alice.page.locator('.unknown-banner').waitFor();
        await alice.page.waitForTimeout(300);
        await assertFits(alice.page, `unknown sender ${label}`);
        await snap(alice, `11-unknown-sender-${label}`);
        await alice.page.locator('.request-btn--outline').click();
        await alice.page.locator('.pay-with').waitFor();
        await assertFits(alice.page, `confirm sheet ${label}`);
        await snap(alice, `12-confirm-sheet-${label}`);
        await navigate(alice.page, '/address-book');
      });
    }
  }
  await setLocale(bob.page, 'en-US');
  await setLocale(alice.page, 'en-US');

  assert.deepEqual(pageErrors, [], 'uncaught page errors');
  console.log('PASS: contact chat end to end');
} catch (error) {
  console.error(`FAIL at step "${currentStep}"`);
  await saveFailureShots();
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

// ---------------------------------------------------------------------------
// Scenario helpers (hoisted: they read the module-level actors and relay)
// ---------------------------------------------------------------------------

function expectAuth(who) {
  const match = relay.log.auths.find((entry) => entry.host === AUTH_HOST && entry.pubkey === who.pubkey);
  assert.ok(match, `${who.name} answered the AUTH challenge of ${AUTH_HOST} with the identity key`);
}

/** The bottom bar is either the money buttons or the composer; get back to the money buttons. */
async function showMoneyBar(page) {
  const back = page.getByRole('button', { name: 'Back to payments' });
  if (await back.count()) await back.click();
}

/**
 * Alice's request sheet. `receiveIn` picks a wallet by name; `receiveMatrix` asserts which of her
 * four wallet types can receive a request (Arkade cannot create invoices).
 */
async function requestMoney(page, sats, note, { receiveIn, receiveMatrix = false } = {}) {
  await showMoneyBar(page);
  await page.getByRole('button', { name: 'Request', exact: true }).click();
  const sheet = page.getByRole('region', { name: /^Request from/ });
  await sheet.getByRole('textbox', { name: 'Amount in sats' }).fill(sats);
  await sheet.getByRole('textbox', { name: 'Note (optional)' }).fill(note);
  if (receiveIn || receiveMatrix) {
    await sheet.getByRole('button', { name: /Receive in/ }).click();
    const option = (name) => sheet.getByRole('option', { name: new RegExp(name) });
    if (receiveMatrix) {
      // Every type can receive a request; Arkade has no invoices of its own, so it falls back to
      // the profile address and says where the money lands.
      assert.equal(await sheet.getByRole('option').count(), 4);
      for (const name of ['Business', 'Shop', 'Alby Hub', 'Ark']) assert.notEqual(await option(name).getAttribute('aria-disabled'), 'true', `${name} can receive`);
      assert.equal(await option('Business').getAttribute('aria-selected'), 'true', 'the Spark wallet is the default');
      await option('Ark').click();
      await sheet.getByText(/Ark cannot create invoices\. The request is paid to your profile address/).waitFor();
      await snap(actors.alice, '04-receive-in-arkade');
      await sheet.getByRole('button', { name: /Receive in/ }).click();
    }
    await option(receiveIn || 'Business').click();
  }
  await sheet.getByRole('button', { name: /^Request .*\d/ }).click();
  await sheet.waitFor({ state: 'hidden' });
}

/** Bob taps Pay on a request card and lands on the confirm sheet. */
async function payRequestFromChat({ page }, cardName) {
  await chatCard(page, cardName).getByRole('button', { name: 'Pay' }).click();
  await page.getByText('Pay with', { exact: true }).waitFor();
}

/** After the confirm sheet: the success screen shows and exactly the expected wallet paid. */
async function expectPaidFrom({ page }, walletId, count) {
  await page.getByText('Payment Sent', { exact: true }).waitFor();
  const payments = await page.evaluate(() => window.__e2ePayments);
  assert.equal(payments.length, count, 'one payment per request');
  assert.equal(payments.at(-1).walletId, walletId, 'the wallet chosen in "Pay with" paid');
}

async function openMenuBadge(page) {
  await page.getByRole('button', { name: /menu/i }).first().click();
  await page.getByRole('button', { name: 'Address Book, New messages: 1' }).waitFor();
}

/** Choose a wallet in the "Pay with" field of the confirm sheet. */
async function payWith(page, name) {
  await page.getByRole('button', { name: /Pay with/ }).click();
  await page.getByRole('listbox').getByRole('option', { name: new RegExp(name) }).click();
}

/**
 * The paying-wallet matrix for a Lightning invoice: Spark, NWC and LNbits can pay, Arkade is
 * listed but disabled with its reason. The active wallet leads and is selected.
 */
async function payWithOptionsMatrix(page) {
  await page.getByRole('button', { name: /Pay with/ }).click();
  const list = page.getByRole('listbox');
  const option = (name) => list.getByRole('option', { name: new RegExp(name) });
  assert.equal(await list.getByRole('option').count(), 4, 'every connected wallet is listed');
  assert.match(await list.getByRole('option').first().innerText(), /Personal/, 'the active wallet leads');
  assert.equal(await option('Personal').getAttribute('aria-selected'), 'true');
  for (const name of ['Personal', 'Alby Hub', 'Shop']) {
    assert.notEqual(await option(name).getAttribute('aria-disabled'), 'true', `${name} can pay`);
  }
  assert.equal(await option('Ark').getAttribute('aria-disabled'), 'true', 'Arkade cannot pay Lightning');
  await option('Ark').getByText('Lightning unavailable').waitFor();
  await option('Personal').click();
}

async function confirmPayment(page) {
  await page.getByRole('button', { name: /^Send .*sats$/ }).click();
}

async function deliverFromCarol(template) {
  const { wraps } = sealAndWrap({ template, senderSecretKey: CAROL.secretKey, recipients: [ALICE.pubkey], selfCopy: false });
  for (const { event } of wraps) relay.inject(event);
}

/** Nothing of the screen (or an open sheet) sticks out sideways, and the page does not scroll sideways. */
async function assertFits(page, label) {
  const problems = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll('.chat *, .chat-state *, .q-dialog__inner *')]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && (box.right > width + 1 || box.left < -1) && getComputedStyle(node).position !== 'fixed';
      })
      .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}`);
    if (document.documentElement.scrollWidth > width) out.push('page scrolls sideways');
    return [...new Set(out)].slice(0, 6);
  });
  assert.deepEqual(problems, [], `horizontal overflow (${label})`);
}
