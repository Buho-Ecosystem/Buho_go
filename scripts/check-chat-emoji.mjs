// Real app, isolated identities and simulated relays. No real messages or payments.
// Run against the local Quasar server: npm run check:chat-emoji
//
// Two browsers share one simulated relay: a desktop (mouse) and a phone
// (touch). The picker behaves differently for each: a mouse gets the emoji
// button in the message field and a docked panel; touch types emoji with its
// own keyboard and uses the picker, as a bottom sheet, for reactions only.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { finalizeEvent, generateSecretKey, getEventHash, nip44, verifyEvent } from 'nostr-core'
import { deriveNostrIdentity } from '../src/utils/identityCrypto.js'
import { SimRelay } from './fixtures/contactChat.mjs'

const base = process.env.CONTACT_CHAT_BASE_URL || 'http://localhost:9012'
const output = process.env.EMOJI_OUTPUT || 'output/chat-emoji'
await mkdir(output, { recursive: true })
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const alice = deriveNostrIdentity(mnemonic)
const bob = deriveNostrIdentity('legal winner thank year wave sausage worth useful legal winner thank yellow')
const relay = new SimRelay()
relay.inject(finalizeEvent({ kind: 10050, created_at: Math.floor(Date.now() / 1000), tags: [['relay', 'wss://auth.nostr1.com']], content: '' }, bob.privateKey))
const bobProfile = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: 'Bob' }) }, bob.privateKey)
// Uncaught exceptions, and the error events a page raises without throwing
// (a ResizeObserver loop is one): both must stay empty.
const errors = []
const browser = await chromium.launch({ headless: true })

/** The page the helpers below act on: the desktop first, the phone later. */
let page

/** A fresh browser profile with Alice signed in and the chat with Bob open. */
async function openChat(options) {
  const context = await browser.newContext(options)
  context.setDefaultTimeout(15000)
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === base) return route.continue()
    if (url.hostname === 'mempool.space') return route.fulfill({ json: { USD: 85000, EUR: 78000 } })
    return route.abort()
  })
  await context.routeWebSocket(/.*/, socket => {
    if (new URL(socket.url()).host === new URL(base).host) return socket.connectToServer()
    const connection = relay.attach(socket.url(), frame => { try { socket.send(JSON.stringify(frame)) } catch {} })
    socket.onMessage(raw => connection.onMessage(String(raw)))
    socket.onClose(() => connection.onClose())
  })
  await context.addInitScript(() => {
    localStorage.setItem('buhoGO_language', 'en-US')
    localStorage.setItem('buho.theme', 'light')
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }))
    window.__errorEvents = []
    window.addEventListener('error', event => window.__errorEvents.push(event.message || 'error'))
  })
  const opened = await context.newPage()
  opened.on('pageerror', error => errors.push(error.stack || error.message))
  await opened.goto(`${base}/#/address-book`)
  await opened.locator('.add-contact-btn').waitFor()
  await opened.evaluate(async ({ mnemonic, bob, event }) => {
    const { useIdentityStore } = await import('/src/stores/identity.js')
    const { useAddressBookStore } = await import('/src/stores/addressBook.js')
    await useIdentityStore().importMnemonic(mnemonic, true)
    const book = useAddressBookStore()
    await book.initialize()
    await book.addNostrContact({ pubkey: bob.publicKeyHex, npub: bob.npub, event, allowWithoutLightningAddress: true })
  }, { mnemonic, bob, event: bobProfile })
  await opened.getByRole('button', { name: /^Bob\b/ }).click()
  await opened.getByRole('textbox', { name: 'Message', exact: true }).waitFor()
  return opened
}
const errorEvents = async () => errors.push(...await page.evaluate(() => window.__errorEvents.splice(0)))

const search = () => page.getByRole('searchbox', { name: 'Search emoji' })
const field = () => page.getByRole('textbox', { name: 'Message', exact: true })
const open = () => page.getByRole('button', { name: 'Choose emoji', exact: true }).click()
const close = () => page.getByRole('button', { name: 'Close emoji picker' }).click()
const shot = async name => {
  await page.evaluate(() => document.fonts.ready)
  if (await page.locator('.emoji-sheet').count()) {
    await page.waitForFunction(() => {
      const sheet = document.querySelector('.emoji-sheet')
      if (!sheet) return false
      const box = sheet.getBoundingClientRect()
      return box.height > 100 && box.top >= 0 && box.bottom <= window.innerHeight + 1
    })
    // Let Quasar's entering transform settle before recording visual evidence.
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' })
}
const setTheme = async dark => {
  await page.evaluate(value => document.querySelector('#q-app').__vue_app__.config.globalProperties.$q.dark.set(value), dark)
  await page.waitForFunction(value => document.body.classList.contains('body--dark') === value, dark)
}
const waitValue = async expected => {
  await page.waitForFunction(value => document.querySelector('.composer__input')?.value === value, expected)
}
const fieldHasFocus = () => field().evaluate(el => document.activeElement === el)
async function test(name, run) { await run(); console.log(`ok ${name}`) }
/** A long press, the way a finger does it. */
async function longPress(bubble) {
  await bubble.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 200, clientY: 200 })
  await page.getByRole('group', { name: 'React', exact: true }).waitFor()
  await bubble.dispatchEvent('pointerup', { pointerType: 'touch' })
}

// Independently inspect the events accepted by the relay, using only Nostr
// primitives. A local optimistic bubble alone does not prove interoperability.
function decryptWrap(wrap, recipient) {
  assert.equal(wrap.kind, 1059)
  assert.equal(verifyEvent(wrap), true)
  assert.ok(wrap.tags.some(tag => tag[0] === 'p' && tag[1] === recipient.publicKeyHex))
  assert.notEqual(wrap.pubkey, alice.publicKeyHex)
  assert.notEqual(wrap.pubkey, bob.publicKeyHex)
  const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(recipient.privateKey, wrap.pubkey)))
  assert.equal(seal.kind, 13)
  assert.equal(verifyEvent(seal), true)
  assert.deepEqual(seal.tags, [])
  const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(recipient.privateKey, seal.pubkey)))
  assert.equal(rumor.pubkey, seal.pubkey)
  assert.equal(rumor.id, getEventHash(rumor))
  assert.equal(rumor.sig, undefined)
  return rumor
}

async function acceptedRumor(kind, content, recipient = bob) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    for (const wrap of relay.find({ kind: 1059 })) {
      if (!wrap.tags.some(tag => tag[0] === 'p' && tag[1] === recipient.publicKeyHex)) continue
      const rumor = decryptWrap(wrap, recipient)
      if (rumor.kind === kind && rumor.content === content) return rumor
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Recipient never received expected kind ${kind}`)
}

// An incoming peer uses standard NIP-17/25/59 fields, without app-specific tags
// or the app's protocol/gift-wrap builders.
function receiveFromBob(kind, content, tags = []) {
  const now = Math.floor(Date.now() / 1000)
  const rumor = { kind, content, tags: [['p', alice.publicKeyHex], ...tags], created_at: now, pubkey: bob.publicKeyHex }
  rumor.id = getEventHash(rumor)
  const seal = finalizeEvent({ kind: 13, tags: [], created_at: now - 1,
    content: nip44.encrypt(JSON.stringify(rumor), nip44.getConversationKey(bob.privateKey, alice.publicKeyHex)) }, bob.privateKey)
  const ephemeralKey = generateSecretKey()
  relay.inject(finalizeEvent({ kind: 1059, tags: [['p', alice.publicKeyHex]], created_at: now - 1,
    content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephemeralKey, alice.publicKeyHex)) }, ephemeralKey))
  return rumor
}

let sentMessage

try {
  console.log('Preparing isolated chat (desktop)')
  page = await openChat({ viewport: { width: 1440, height: 1000 } })

  await test('desktop dock leaves the conversation usable and search focused', async () => {
    const bar = await page.locator('.composer__field').boundingBox()
    const emojiButton = await page.locator('.composer__emoji').boundingBox()
    const input = await field().boundingBox()
    assert.ok(emojiButton.x >= bar.x && emojiButton.x + emojiButton.width <= bar.x + bar.width)
    assert.ok(emojiButton.y >= bar.y && emojiButton.y + emojiButton.height <= bar.y + bar.height)
    assert.ok(input.x + input.width <= emojiButton.x)
    assert.ok(emojiButton.width >= 44 && emojiButton.height >= 44)
    await open()
    await search().waitFor()
    assert.equal(await search().evaluate(el => document.activeElement === el), true)
    const panel = await page.locator('.emoji-panel').boundingBox()
    const chat = await page.locator('.chat').boundingBox()
    assert.ok(chat.x + chat.width <= panel.x)
    assert.equal(await page.locator('.q-dialog:visible').count(), 0)
    await shot('desktop-light')
    await setTheme(true)
    await shot('desktop-dark')
    await setTheme(false)
  })

  await test('opening the side panel resizes an existing wrapped draft without hiding its lines', async () => {
    await close()
    await field().fill('A draft should remain readable when the emoji panel opens. '.repeat(5))
    await open()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const size = await field().evaluate(el => ({ visible: el.clientHeight, needed: el.scrollHeight }))
    assert.ok(size.visible >= Math.min(size.needed, 134), `draft needs ${size.needed}px but shows ${size.visible}px`)
    await close()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(await page.evaluate(() => window.__errorEvents), [], 'refitting raises no error event (ResizeObserver loop)')
    await field().fill('')
    await open()
  })

  await test('cursor insertion replaces selected text and supports consecutive picks', async () => {
    await close()
    await field().fill('Hello Bob!')
    // The caret is read from the field when the emoji is picked: no event has to announce it.
    await field().evaluate(el => { el.focus(); el.setSelectionRange(6, 9) })
    await open()
    await search().fill('pizza')
    await page.locator('[data-emoji="🍕"]').first().click()
    await waitValue('Hello 🍕!')
    assert.equal(await field().evaluate(el => document.activeElement === el), true, 'desktop selection returns to typing')
    await page.locator('[data-emoji="🍕"]').first().click()
    await waitValue('Hello 🍕🍕!')
    await page.locator('.composer__row').screenshot({ path: `${output}/composer-inline-desktop.png` })
    await page.keyboard.press('Escape')
    await page.locator('.emoji-panel').waitFor({ state: 'hidden' })
    assert.equal(await field().evaluate(el => document.activeElement === el), true, 'Escape keeps the text cursor ready')
  })

  await test('keyboard search, empty results, categories and Escape', async () => {
    await open()
    await search().fill('unfindablezzzz')
    await page.getByRole('status').filter({ hasText: 'No emoji found' }).waitFor()
    await search().fill('heart')
    await search().press('ArrowDown')
    assert.ok(await page.evaluate(() => !!document.activeElement.dataset.emoji))
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await search().fill('eyes')
    assert.equal(await page.locator('[data-emoji]').first().getAttribute('data-emoji'), '👀')
    await search().fill('')
    await page.getByRole('button', { name: 'Food & Drink', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Food & Drink', exact: true }).getAttribute('aria-current'), 'true')
    await page.keyboard.press('Escape')
    await page.locator('.emoji-panel').waitFor({ state: 'hidden' })
  })

  await test('emoji message sends through the real encrypted chat runtime', async () => {
    await field().fill('Pizza 🍕❤️')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.locator('.bubble').filter({ hasText: 'Pizza 🍕❤️' }).waitFor()
    await waitValue('')
    await page.locator('.bubble-row').filter({ hasText: 'Pizza 🍕❤️' }).getByRole('status').filter({ hasText: 'Sent' }).waitFor()
    sentMessage = await acceptedRumor(14, 'Pizza 🍕❤️')
    assert.equal(sentMessage.pubkey, alice.publicKeyHex)
    assert.ok(sentMessage.tags.some(tag => tag[0] === 'p' && tag[1] === bob.publicKeyHex))
    const selfCopy = await acceptedRumor(14, 'Pizza 🍕❤️', alice)
    assert.equal(selfCopy.id, sentMessage.id)
    assert.ok(relay.log.auths.some(auth => auth.host === 'auth.nostr1.com' && auth.pubkey === alice.publicKeyHex))
    assert.ok(relay.find({ kind: 1059 }).every(wrap => !wrap.content.includes('Pizza') && !wrap.content.includes('🍕')))
  })

  await test('desktop message hover opens reactions directly, with a one-click add and change path', async () => {
    const row = page.locator('.bubble-row').filter({ hasText: 'Pizza 🍕❤️' })
    await field().focus()
    await page.mouse.move(0, 0)
    assert.equal(await row.locator('.bubble__react-button').isVisible(), false)
    await row.locator('.bubble').hover()
    const reactButton = row.getByRole('button', { name: 'React', exact: true })
    const bounds = await reactButton.boundingBox()
    await page.mouse.move(bounds.x + bounds.width + 3, bounds.y + bounds.height / 2, { steps: 12 })
    assert.equal(await reactButton.isVisible(), true, 'the pointer can cross the gap to the reaction button')
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 6 })
    await shot('desktop-reaction-hover')
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.getByRole('heading', { name: 'React', exact: true }).waitFor()
    await search().fill('owl')
    await page.locator('[data-emoji="🦉"]').first().click()
    await acceptedRumor(7, '🦉')
    assert.equal(await row.locator('.bubble__react-button').count(), 0, 'existing reactions use the inline add button')
    const ownBounds = await row.getByRole('button', { name: /🦉.*Change reaction/ }).boundingBox()
    const addBounds = await row.getByRole('button', { name: 'Add reaction', exact: true }).boundingBox()
    assert.ok(ownBounds.width >= 44 && ownBounds.height >= 44 && addBounds.width >= 44 && addBounds.height >= 44)
    assert.ok(ownBounds.x + ownBounds.width <= addBounds.x, 'adjacent touch targets never overlap')
    await row.getByRole('button', { name: /🦉.*Change reaction/ }).click()
    await page.getByRole('heading', { name: 'React', exact: true }).waitFor()
    await close()
    await row.getByRole('button', { name: 'Add reaction', exact: true }).click()
    await page.getByRole('heading', { name: 'React', exact: true }).waitFor()
    await close()
    await row.locator('.bubble').focus()
    await page.keyboard.press('Tab')
    assert.equal(await row.getByRole('button', { name: /🦉.*Change reaction/ }).evaluate(el => document.activeElement === el), true)
    await page.keyboard.press('Enter')
    await search().waitFor()
    await close()
    receiveFromBob(7, '❤️', [['e', sentMessage.id], ['k', '14']])
    const peerReaction = row.getByRole('button', { name: '❤️ 1 reaction', exact: true })
    await peerReaction.waitFor()
    const peerBounds = await peerReaction.boundingBox()
    await page.mouse.click(peerBounds.x + peerBounds.width - 2, peerBounds.y + peerBounds.height / 2)
    await acceptedRumor(7, '❤️')
    assert.equal(await page.locator('.emoji-panel').count(), 0, 'tapping another reaction adds it immediately')
    await shot('desktop-reaction-chips')
  })

  await test('More emojis opens the shared picker and sends a reaction', async () => {
    await open()
    await search().fill('old query')
    await page.locator('.bubble').filter({ hasText: 'Pizza 🍕❤️' }).click({ button: 'right' })
    await page.getByRole('button', { name: 'More emojis' }).click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search emoji' && document.activeElement.value === '')
    await search().fill('rocket')
    await page.locator('[data-emoji="🚀"]').first().click()
    await page.getByRole('group', { name: 'Reactions', exact: true }).getByRole('button', { name: /🚀/ }).waitFor()
    const reaction = await acceptedRumor(7, '🚀')
    assert.ok(reaction.tags.some(tag => tag[0] === 'e' && tag[1] === sentMessage.id))
    assert.ok(reaction.tags.some(tag => tag[0] === 'k' && tag[1] === '14'))
    assert.ok(reaction.tags.some(tag => tag[0] === 'p' && tag[1] === bob.publicKeyHex))
    await page.locator('.emoji-panel').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.classList.contains('bubble'))
    await open()
    await shot('desktop-thread-light')
    await setTheme(true)
    await shot('desktop-thread-dark')
    await setTheme(false)
    await close()
  })

  await test('reopening reactions starts a fresh focused search, even for the same message', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('.bubble').filter({ hasText: 'Pizza 🍕❤️' }).click({ button: 'right' })
      await page.getByRole('button', { name: 'More emojis' }).click()
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search emoji' && document.activeElement.value === '')
      await search().fill('stale query')
    }
    await close()
  })

  await test('a narrow window gets a sheet: one pick goes into the draft, the sheet closes and the caret is back in the text', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await field().fill('Narrow ')
    const bar = await page.locator('.composer__field').boundingBox()
    const button = await page.locator('.composer__emoji').boundingBox()
    assert.ok(button.x >= bar.x && button.x + button.width <= bar.x + bar.width)
    await open()
    await page.locator('.emoji-sheet').waitFor()
    assert.equal(await page.locator('.emoji-panel').count(), 0)
    await search().fill('owl')
    await page.locator('[data-emoji="🦉"]').first().click()
    await waitValue('Narrow 🦉')
    await page.locator('.emoji-sheet').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.classList.contains('composer__input'))
    await page.keyboard.type('!')
    await waitValue('Narrow 🦉!')
    // Closed without a pick, focus returns to the button that opened it.
    await page.locator('.composer__emoji').focus()
    await page.keyboard.press('Enter')
    await page.locator('.emoji-sheet').waitFor()
    await close()
    await page.locator('.emoji-sheet').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Choose emoji')
  })

  await test('switching between the sheet and the desktop dock preserves the draft', async () => {
    await open()
    await page.locator('.emoji-sheet').waitFor({ state: 'visible' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('.emoji-panel').waitFor({ state: 'visible' })
    await waitValue('Narrow 🦉!')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.emoji-sheet').waitFor({ state: 'visible' })
    await close()
    await page.locator('.emoji-sheet').waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await field().fill('')
  })

  await test('German and Spanish searches understand common local words, also while they are still being typed', async () => {
    for (const [locale, label, queries] of [
      ['de', 'Emojis suchen', [['lachen', '😂'], ['lach', '😂'], ['hunde', '🐶'], ['pferd', '🐴'], ['tiere', '🐶']]],
      ['es', 'Buscar emojis', [['corazón', '❤️'], ['coraz', '❤️'], ['perros', '🐶']]],
    ]) {
      await page.evaluate(value => { document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n.locale = value }, locale)
      await page.locator('.composer__emoji').click()
      for (const [query, char] of queries) {
        await page.getByRole('searchbox', { name: label }).fill(query)
        assert.ok(await page.locator(`[data-emoji="${char}"]`).count(), `${locale}: ${query}`)
        assert.equal(await page.locator('.emoji-picker__empty').count(), 0, `${locale}: "${query}" never shows the empty state`)
      }
      await page.locator('.emoji-picker__button').click()
      await page.locator('.emoji-panel').waitFor({ state: 'hidden' })
    }
    await page.evaluate(() => { document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n.locale = 'en-US' })
  })

  await test('recents survive reopening, come along from the first version\'s key, and malformed storage never breaks the picker', async () => {
    await open()
    await page.getByRole('heading', { name: 'Recently used', exact: true }).waitFor()
    await close()
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('buho.emojiRecents')).length > 0))
    await page.evaluate(() => { localStorage.removeItem('buho.emojiRecents'); localStorage.setItem('buho:emoji-recents', JSON.stringify(['🦉'])) })
    await open()
    await page.getByRole('heading', { name: 'Recently used', exact: true }).waitFor()
    assert.equal(await page.locator('[data-section="recent"] [data-emoji]').count(), 1)
    await close()
    await page.evaluate(() => localStorage.setItem('buho.emojiRecents', '{broken'))
    await open()
    await page.getByRole('heading', { name: 'Quick reactions', exact: true }).waitFor()
    await close()
  })

  await test('the picker\'s chrome is words and outline icons: no emoji in the rail, no tagline, cells named by the emoji itself', async () => {
    await open()
    const rail = page.getByRole('navigation', { name: 'Emoji categories' })
    assert.equal(await rail.locator('svg').count(), await rail.getByRole('button').count())
    assert.doesNotMatch(await rail.innerText(), /\p{Extended_Pictographic}/u)
    assert.equal(await page.locator('.emoji-picker__preview').count(), 0)
    assert.equal(await page.locator('[data-emoji="🦉"]').first().getAttribute('aria-label'), null)
    await search().fill('unfindablezzzz')
    assert.equal(await page.getByRole('status').filter({ hasText: 'No emoji found' }).locator('svg').count(), 1)
    await close()
  })

  await test('standard Nostr peer messages and reactions render without exposing protocol details', async () => {
    receiveFromBob(14, 'See you soon 👩🏽‍💻 🏳️‍🌈 ❤️')
    await page.locator('.bubble').filter({ hasText: 'See you soon 👩🏽‍💻 🏳️‍🌈 ❤️' }).waitFor()
    receiveFromBob(7, '🦉', [['e', sentMessage.id], ['k', '14']])
    await page.locator('.bubble-row').filter({ hasText: 'Pizza 🍕❤️' }).getByRole('button', { name: /🦉.*reaction/ }).waitFor()
    assert.equal(await page.getByText(/NIP-17|NIP-25|NIP-59|kind 1059|gift.?wrap|pubkey/i).count(), 0)
  })

  await errorEvents()

  console.log('Preparing isolated chat (phone, touch)')
  await page.context().close()
  page = await openChat({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const bubble = page.locator('.bubble').filter({ hasText: 'Pizza 🍕❤️' })
  await bubble.waitFor()

  await test('touch: the message field has no emoji button (the keyboard has emoji) and stays full width', async () => {
    assert.equal(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), false, 'the phone context reports touch')
    assert.equal(await page.locator('.composer__emoji').isVisible(), false)
    assert.equal(await page.locator('.bubble__react-button').first().isVisible(), false, 'no hover button either: touch has the long press')
    const bar = await page.locator('.composer__field').boundingBox()
    const input = await field().boundingBox()
    assert.ok(bar.width - input.width < 12, 'the text uses the whole field')
    await field().fill('Typed with the keyboard 🦉')
    await waitValue('Typed with the keyboard 🦉')
    await field().fill('')
  })

  await test('touch: long press offers quick reactions and More emojis; the sheet does not raise the keyboard', async () => {
    await longPress(bubble)
    await shot('touch-reaction-choices')
    await page.getByRole('button', { name: 'More emojis' }).click()
    await page.locator('.emoji-sheet').waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'React', exact: true }).waitFor()
    assert.equal(await search().evaluate(el => document.activeElement === el), false, 'focus would raise the keyboard over the list')
    assert.equal(await page.locator('.emoji-sheet .form-sheet-grabber').count(), 1)
    const sheet = await page.locator('.emoji-sheet').boundingBox()
    assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= 390)
    const cell = await page.locator('[data-emoji]').first().boundingBox()
    assert.ok(cell.width >= 44 && cell.height >= 44)
    await shot('mobile-light')
    await setTheme(true)
    await shot('mobile-dark')
    await setTheme(false)
  })

  await test('touch: one pick sends the reaction, closes the sheet and returns to the message', async () => {
    await page.locator('[data-emoji="🎉"]').first().tap()
    await page.locator('.emoji-sheet').waitFor({ state: 'hidden' })
    await page.getByRole('group', { name: 'Reactions', exact: true }).getByRole('button', { name: /🎉/ }).waitFor()
    await acceptedRumor(7, '🎉')
    await page.waitForFunction(() => document.activeElement?.classList.contains('bubble'))
  })

  await test('touch: closing the sheet without a pick sends nothing and returns to the message', async () => {
    const before = relay.find({ kind: 1059 }).length
    await longPress(bubble)
    await page.getByRole('button', { name: 'More emojis' }).click()
    await page.locator('.emoji-sheet').waitFor({ state: 'visible' })
    await close()
    await page.locator('.emoji-sheet').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.classList.contains('bubble'))
    assert.equal(relay.find({ kind: 1059 }).length, before)
  })

  await test('touch, 320px: the sheet fits, the grid has six columns and nothing is clipped', async () => {
    await page.setViewportSize({ width: 320, height: 700 })
    await longPress(bubble)
    await page.getByRole('button', { name: 'More emojis' }).click()
    await page.locator('.emoji-sheet').waitFor({ state: 'visible' })
    const sheet = await page.locator('.emoji-sheet').boundingBox()
    assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= 320)
    assert.equal(await page.getByRole('navigation', { name: 'Emoji categories' }).isVisible(), false, 'the grid gets the rail\'s width')
    const tops = await page.locator('[data-section="smileys"] [data-emoji]').evaluateAll(cells => cells.slice(0, 8).map(cell => Math.round(cell.getBoundingClientRect().top)))
    assert.equal(tops.filter(top => top === tops[0]).length, 6)
    await shot('mobile-320-light')
    await close()
    await page.locator('.emoji-sheet').waitFor({ state: 'hidden' })
  })
  // Last, so the screenshots above show a thread as people know it.
  await test('a reaction that is words instead of an emoji stays a pill', async () => {
    receiveFromBob(7, 'this is a sentence someone sent as a reaction', [['e', sentMessage.id], ['k', '14']])
    const pill = page.locator('.bubble-row').filter({ hasText: 'Pizza 🍕❤️' }).getByRole('button', { name: /this is a sentence/ }).locator('.bubble__reaction-pill')
    await pill.waitFor()
    const box = await pill.boundingBox()
    assert.ok(box.width <= 130, `the pill is ${box.width}px wide`)
  })
  await errorEvents()

  assert.deepEqual(errors, [])
  console.log(`Screenshots: ${output}`)
} catch (error) {
  await shot('FAIL').catch(() => {})
  throw error
} finally { await browser.close() }
