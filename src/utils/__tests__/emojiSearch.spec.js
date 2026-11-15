/**
 * Emoji search: ranking, and German and Spanish words reaching the English
 * catalog.
 *
 *   node --test src/utils/__tests__/emojiSearch.spec.js
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMOJI_CATEGORIES, emojiEntry } from '../emojiCatalog.js'
import { EMOJI_SEARCH_TERMS } from '../emojiSearchTerms.js'
import { normalizeQuery, scoreEmoji, scoreMatch, translatedTerms } from '../emojiSearch.js'

const ALL = EMOJI_CATEGORIES.flatMap(category => category.emojis.map(entry => ({ entry, title: category.title })))

/** The picker's search, without the picker: characters, best first. */
function find(raw) {
  const query = normalizeQuery(raw)
  const translated = translatedTerms(query)
  return ALL
    .map(({ entry, title }) => ({ char: entry.char, score: scoreMatch(entry, title, query, translated) }))
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(hit => hit.char)
}

test('catalog: every emoji once, each with a name; categories carry an outline icon for the rail', () => {
  const chars = ALL.map(({ entry }) => entry.char)
  assert.equal(new Set(chars).size, chars.length)
  for (const { entry } of ALL) assert.ok(entry.name, entry.char)
  for (const category of EMOJI_CATEGORIES) assert.match(category.icon, /^tabler:[a-z0-9-]+$/, category.id)
  assert.equal(emojiEntry('🦉').name, 'owl')
  assert.equal(emojiEntry('not an emoji'), undefined)
})

test('normalizeQuery: case, accents, colons and spaces do not matter', () => {
  assert.equal(normalizeQuery('  :Corazón:  '), 'corazon')
  assert.equal(normalizeQuery('GLÜCKLICH'), 'glucklich')
  assert.equal(normalizeQuery('red   heart'), 'red heart')
  assert.equal(normalizeQuery('   '), '')
})

test('every translated word leads to at least one emoji by name or keyword start', () => {
  for (const [word, term] of Object.entries(EMOJI_SEARCH_TERMS)) {
    assert.equal(word, normalizeQuery(word), `${word} is stored the way a query is normalized`)
    assert.ok(ALL.some(({ entry }) => scoreEmoji(entry, term) >= 3), `${word} -> ${term} finds nothing`)
  }
})

test('translated words: the word, the start of it, and the word with an ending', () => {
  assert.deepEqual(translatedTerms('lachen'), ['laugh'])
  assert.ok(translatedTerms('lach').includes('laugh'), 'found while still typing')
  assert.deepEqual(translatedTerms('hunde'), ['dog'])
  assert.deepEqual(translatedTerms('gatos'), ['cat'])
  assert.deepEqual(translatedTerms('pferd'), ['horse'])
  assert.deepEqual(translatedTerms('la'), [], 'two letters are not the start of anything yet')
  assert.deepEqual(translatedTerms('sol'), ['sun'])
  assert.deepEqual(translatedTerms('solo'), [], 'a short word only counts in full')
  assert.deepEqual(translatedTerms(''), [])
})

test('search: German and Spanish find what English finds', () => {
  assert.equal(find('pferd')[0], '🐴')
  assert.equal(find('Hunde')[0], '🐶')
  assert.equal(find('perro')[0], '🐶')
  assert.ok(find('lach').includes('😂'))
  assert.ok(find('glücklich').includes('😀'))
  assert.ok(find('corazón').includes('❤️'))
  assert.deepEqual(find('búho'), ['🦉'])
  assert.deepEqual(find('unfindablezzzz'), [])
})

test('ranking: what the typed word finds comes first, a loose match of it last', () => {
  // "pand" could be read as the Spanish "pan" (bread) with an ending; the panda was typed.
  assert.equal(find('pand')[0], '🐼')
  // "hunde" sits inside "thunder": that is a guess, the dog is what was meant.
  const hunde = find('hunde')
  assert.ok(hunde.indexOf('🐶') < hunde.indexOf('⛈️'))
  assert.equal(find('eyes')[0], '👀')
  assert.equal(find('star')[0], '⭐')
  // A section's English title finds its emoji, below matches by name.
  assert.ok(find('smileys').length > 50)
})
