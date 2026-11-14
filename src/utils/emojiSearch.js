// Adapted from Lotus src/lib/emoji/search.ts. Unicode characters use the system emoji font.
const SCORE = {
  nameExact: 6,
  namePrefix: 5,
  nameWordPrefix: 4,
  keywordPrefix: 3,
  nameContains: 2,
  keywordContains: 1,
  none: 0
};
const SEARCH_ALIASES = {
  herz: 'heart', herzen: 'heart', liebe: 'love', lachen: 'laugh', lustig: 'funny', glucklich: 'happy', lacheln: 'smile', traurig: 'sad', weinen: 'cry', danke: 'thanks', daumen: 'thumb', feuer: 'fire', sonne: 'sun', stern: 'star', sterne: 'star', augen: 'eyes', zunge: 'tongue', hund: 'dog', katze: 'cat', eule: 'owl', kaffee: 'coffee', bier: 'beer', geld: 'money', geburtstag: 'birthday', feiern: 'party', essen: 'food', trinken: 'drink', reisen: 'travel', tiere: 'animals', natur: 'nature',
  corazon: 'heart', corazones: 'heart', amor: 'love', reir: 'laugh', risa: 'laugh', feliz: 'happy', sonrisa: 'smile', triste: 'sad', llorar: 'cry', gracias: 'thanks', pulgar: 'thumb', fuego: 'fire', sol: 'sun', estrella: 'star', estrellas: 'star', ojos: 'eyes', lengua: 'tongue', perro: 'dog', gato: 'cat', buho: 'owl', cafe: 'coffee', cerveza: 'beer', dinero: 'money', cumpleanos: 'birthday', fiesta: 'party', comida: 'food', bebida: 'drink', viaje: 'travel', animales: 'animals', naturaleza: 'nature'
};
function normalizeQuery(raw) {
  const query = raw.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^:+/, '').replace(/:+$/, '').replace(/\s+/g, ' ');
  return SEARCH_ALIASES[query] || query;
}
function matchesWordStart(haystack, query) {
  return haystack.startsWith(query) || haystack.includes(` ${query}`);
}
function scoreEmoji(emoji, query) {
  if (!query) return SCORE.none;
  const name = emoji.name.toLowerCase();
  if (name === query) return SCORE.nameExact;
  if (name.startsWith(query)) return SCORE.namePrefix;
  if (name.includes(` ${query}`)) return SCORE.nameWordPrefix;
  const parts = name.split(/[_-]/);
  if (parts.length > 1 && parts.some((part) => part.startsWith(query))) return SCORE.nameWordPrefix;
  for (const keyword of emoji.keywords) {
    if (matchesWordStart(keyword.toLowerCase(), query)) return SCORE.keywordPrefix;
  }
  if (name.includes(query)) return SCORE.nameContains;
  for (const keyword of emoji.keywords) {
    if (keyword.toLowerCase().includes(query)) return SCORE.keywordContains;
  }
  return SCORE.none;
}
function scoreTitle(title, query) {
  if (!query) return false;
  return matchesWordStart(title.toLowerCase(), query);
}
function filterSection(title, items, query, describe) {
  if (!query) return [...items];
  if (scoreTitle(title, query)) return [...items];
  const scored = [];
  items.forEach((item, index) => {
    const score = scoreEmoji(describe(item), query);
    if (score > SCORE.none) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.item);
}
export {
  filterSection,
  normalizeQuery,
  scoreEmoji,
  scoreTitle
};
