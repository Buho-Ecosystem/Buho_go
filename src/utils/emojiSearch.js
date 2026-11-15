/**
 * Ranking for the emoji picker's search. Pure, tested under Node.
 *
 * The catalog (utils/emojiCatalog.js) carries English names and keywords.
 * German and Spanish words reach it through utils/emojiSearchTerms.js: a
 * query is searched as typed and, when it is such a word or the start of
 * one, as the catalog term it means. What matches as typed always ranks
 * above what only matches through a translated word.
 */
import { EMOJI_SEARCH_TERMS } from './emojiSearchTerms.js'

const SCORE = {
  nameExact: 6,
  namePrefix: 5,
  nameWordPrefix: 4,
  keywordPrefix: 3,
  nameContains: 2,
  keywordContains: 1,
  none: 0
}

/** A typed word shorter than this is never completed to a translated word. */
const MIN_PREFIX_LENGTH = 3
/** A translated word this short only counts in full ("sol", "pan"). */
const MIN_STEM_LENGTH = 4
/** Endings a typed word may add to a translated word ("hunde", "gatos"). */
const MAX_ENDING_LENGTH = 2

/** Lower case, no accents, no surrounding colons, single spaces. */
function normalizeQuery(raw) {
  return raw.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^:+/, '').replace(/:+$/, '').replace(/\s+/g, ' ')
}

/** The catalog terms a normalized query stands for in German or Spanish. */
function translatedTerms(query) {
  if (!query) return []
  const terms = new Set()
  for (const [word, term] of Object.entries(EMOJI_SEARCH_TERMS)) {
    const completes = query.length >= MIN_PREFIX_LENGTH && word.startsWith(query)
    const inflects = word.length >= MIN_STEM_LENGTH && query.startsWith(word) && query.length - word.length <= MAX_ENDING_LENGTH
    if (word === query || completes || inflects) terms.add(term)
  }
  terms.delete(query)
  return [...terms]
}

function matchesWordStart(haystack, query) {
  return haystack.startsWith(query) || haystack.includes(` ${query}`)
}

function scoreEmoji(emoji, query) {
  if (!query) return SCORE.none
  const name = emoji.name.toLowerCase()
  if (name === query) return SCORE.nameExact
  if (name.startsWith(query)) return SCORE.namePrefix
  if (name.includes(` ${query}`)) return SCORE.nameWordPrefix
  const parts = name.split(/[_-]/)
  if (parts.length > 1 && parts.some((part) => part.startsWith(query))) return SCORE.nameWordPrefix
  for (const keyword of emoji.keywords) {
    if (matchesWordStart(keyword.toLowerCase(), query)) return SCORE.keywordPrefix
  }
  if (name.includes(query)) return SCORE.nameContains
  for (const keyword of emoji.keywords) {
    if (keyword.toLowerCase().includes(query)) return SCORE.keywordContains
  }
  return SCORE.none
}

function scoreTitle(title, query) {
  if (!query) return false
  return matchesWordStart(title.toLowerCase(), query)
}

/**
 * How well an emoji (or its section title) answers a query, 0 for not at all.
 *
 * Order: what the typed word finds by name or keyword start, then what its
 * translation finds the same way, then loose matches of the typed word
 * ("hunde" inside "thunder"). A translation never matches loosely.
 *
 * @param {{ name: string, keywords: string[] }} emoji
 * @param {string} title The section's title, in English.
 * @param {string} query A normalized query (`normalizeQuery`).
 * @param {string[]} [translated] `translatedTerms(query)`, computed once per search.
 */
function scoreMatch(emoji, title, query, translated = translatedTerms(query)) {
  const typed = scoreEmoji(emoji, query)
  if (typed >= SCORE.keywordPrefix) return typed + 2 * SCORE.nameExact
  let best = SCORE.none
  for (const term of translated) best = Math.max(best, scoreEmoji(emoji, term))
  if (best >= SCORE.keywordPrefix) return best + SCORE.nameExact
  return Math.max(typed, scoreTitle(title, query) ? SCORE.keywordContains : SCORE.none)
}

export {
  normalizeQuery,
  scoreEmoji,
  scoreMatch,
  scoreTitle,
  translatedTerms
}
