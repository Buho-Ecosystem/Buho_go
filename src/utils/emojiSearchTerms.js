/**
 * Words people type when they look for an emoji in German or Spanish, and
 * the catalog term each one means (utils/emojiCatalog.js is English).
 *
 * Keys are lower case without accents, exactly as `normalizeQuery` leaves a
 * query. utils/emojiSearch.js matches a word and the start of one, so "lach"
 * finds what "lachen" finds, and "hunde" finds what "hund" finds.
 */
const GERMAN = {
  herz: 'heart', liebe: 'love', kuss: 'kiss', lachen: 'laugh', lustig: 'funny', witzig: 'funny',
  glucklich: 'happy', frohlich: 'happy', freude: 'joy', lacheln: 'smile', grinsen: 'grin', zwinkern: 'wink',
  traurig: 'sad', weinen: 'cry', wutend: 'angry', sauer: 'angry', schlafen: 'sleep', mude: 'sleep',
  krank: 'sick', denken: 'thinking', angst: 'fear', danke: 'thanks', bitte: 'please', daumen: 'thumb',
  klatschen: 'clap', winken: 'wave', faust: 'fist', stark: 'strong', beten: 'pray',
  feuer: 'fire', sonne: 'sun', mond: 'moon', stern: 'star', regen: 'rain', schnee: 'snow', wolke: 'cloud',
  regenbogen: 'rainbow', blume: 'flower', baum: 'tree', augen: 'eyes', zunge: 'tongue',
  hund: 'dog', katze: 'cat', eule: 'owl', pferd: 'horse', maus: 'mouse', bar: 'bear', lowe: 'lion',
  affe: 'monkey', vogel: 'bird', fisch: 'fish', schwein: 'pig', kuh: 'cow', huhn: 'chicken',
  biene: 'bee', schmetterling: 'butterfly', schlange: 'snake',
  kaffee: 'coffee', bier: 'beer', wein: 'wine', kuchen: 'cake', brot: 'bread', kase: 'cheese',
  apfel: 'apple', banane: 'banana', eis: 'ice', schokolade: 'chocolate', essen: 'food', trinken: 'drink',
  geld: 'money', geschenk: 'gift', geburtstag: 'birthday', feiern: 'party', musik: 'music',
  fussball: 'soccer', 'fußball': 'soccer', auto: 'car', flugzeug: 'airplane', fahrrad: 'bicycle',
  reisen: 'travel', uhr: 'clock', telefon: 'phone', handy: 'phone', buch: 'book',
  licht: 'light', schlussel: 'key', rakete: 'rocket', frage: 'question', warnung: 'warning'
}

const SPANISH = {
  corazon: 'heart', amor: 'love', beso: 'kiss', reir: 'laugh', risa: 'laugh', gracioso: 'funny',
  feliz: 'happy', alegria: 'joy', sonrisa: 'smile', guino: 'wink', triste: 'sad', llorar: 'cry',
  enojado: 'angry', enfadado: 'angry', dormir: 'sleep', enfermo: 'sick', pensar: 'thinking', miedo: 'fear',
  gracias: 'thanks', pulgar: 'thumb', mano: 'hand', aplauso: 'clap', saludo: 'wave', puno: 'fist',
  fuerte: 'strong', rezar: 'pray', fuego: 'fire', sol: 'sun', luna: 'moon', estrella: 'star',
  lluvia: 'rain', nieve: 'snow', nube: 'cloud', arcoiris: 'rainbow', flor: 'flower', arbol: 'tree',
  ojos: 'eyes', lengua: 'tongue', perro: 'dog', gato: 'cat', buho: 'owl', caballo: 'horse', raton: 'mouse',
  oso: 'bear', leon: 'lion', mono: 'monkey', pajaro: 'bird', pez: 'fish', cerdo: 'pig', vaca: 'cow',
  pollo: 'chicken', abeja: 'bee', mariposa: 'butterfly', serpiente: 'snake',
  cafe: 'coffee', cerveza: 'beer', vino: 'wine', pastel: 'cake', pan: 'bread', queso: 'cheese',
  manzana: 'apple', platano: 'banana', helado: 'ice', comida: 'food', bebida: 'drink',
  dinero: 'money', regalo: 'gift', cumpleanos: 'birthday', fiesta: 'party', musica: 'music',
  futbol: 'soccer', coche: 'car', avion: 'airplane', bicicleta: 'bicycle',
  viaje: 'travel', reloj: 'clock', telefono: 'phone', libro: 'book', luz: 'light',
  llave: 'key', cohete: 'rocket', pregunta: 'question'
}

export const EMOJI_SEARCH_TERMS = { ...GERMAN, ...SPANISH }
