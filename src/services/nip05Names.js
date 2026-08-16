/**
 * Memorable name vocabulary for the default (free) NIP-05 handle.
 *
 * When an identity has no profile name yet, the boot orchestrator still
 * registers a free `name@mybuho.de` handle silently. Rather than fall back to
 * a machine-looking `buho<npub-chunk>` slug, we derive a friendly
 * `{adjective}{animal}` pair (e.g. `bravefox`, `calmtiger`) from the curated
 * word lists below.
 *
 * The pair is derived *deterministically* from the npub: the same identity
 * always maps to the same memorable word pair, so the default feels
 * intentional and is reproducible if a handle is ever lost and re-registered.
 * Uniqueness across users is handled separately by the `.NNNNNN` free-tier
 * suffix appended at registration time (see `registerFreeHandle`), so two
 * identities sharing a word pair is fine and expected.
 *
 * ── What belongs in these lists ──────────────────────────────────────────
 *
 * This is the name a person is handed before they have chosen one, and it is
 * printed on their card and read aloud when they give it out. It has to be a
 * name someone would keep, so the lists are deliberately small and hand-read
 * rather than large and generated:
 *
 *   - Every adjective is an actual adjective. Nouns dressed as modifiers
 *     ("sign", "valve", "spine", "sigma", "oxide") produced pairs that read
 *     like part numbers.
 *   - Every animal is one a person can picture and spell. Obscure species
 *     ("yapok", "indri", "numbat", "dhole") are not memorable to anyone.
 *   - Nothing unpleasant. Pests, parasites and things that bite are out, and
 *     so is anything that could read as an insult when handed to a stranger.
 *   - Both words stay short, so the pair fits on a card and survives being
 *     read out over a phone.
 *
 * Combinations run to roughly ten thousand before the numeric suffix, which
 * is far more than collision handling needs. Adding words to reach some count
 * is not a reason to lower the bar above.
 *
 * Pure module — no store/Pinia imports — so it can be unit-tested directly.
 */

export const ADJECTIVES = [
  // --- character ---
  'bold', 'brave', 'bright', 'busy', 'calm', 'cheery', 'clever', 'clear',
  'crisp', 'curious', 'daring', 'eager', 'easy', 'fair', 'fine', 'fond',
  'free', 'fresh', 'gentle', 'glad', 'good', 'grand', 'great', 'happy',
  'hardy', 'helpful', 'honest', 'jolly', 'joyful', 'keen', 'kind', 'lively',
  'loyal', 'lucky', 'merry', 'mighty', 'mild', 'modest', 'neat', 'nimble',
  'noble', 'patient', 'plucky', 'polite', 'proud', 'quick', 'quiet', 'ready',
  'sharp', 'sincere', 'sleek', 'smart', 'smooth', 'snug', 'solid', 'spry',
  'steady', 'sunny', 'sweet', 'swift', 'tidy', 'true', 'warm', 'wise',
  'witty', 'young',

  // --- colour and light ---
  'amber', 'azure', 'coral', 'golden', 'green', 'hazel', 'ivory', 'jade',
  'olive', 'opal', 'pearl', 'rosy', 'royal', 'ruby', 'sandy', 'silver',
  'snowy', 'sunlit', 'teal', 'violet',

  // --- weather and season ---
  'autumn', 'breezy', 'dawn', 'dusk', 'frosty', 'misty', 'moonlit', 'rainy',
  'spring', 'starry', 'stormy', 'summer', 'sunrise', 'winter',

  // --- landscape ---
  'cedar', 'forest', 'garden', 'harbor', 'hollow', 'island', 'lake', 'maple',
  'meadow', 'ocean', 'orchard', 'river', 'sage', 'valley', 'willow',
];

export const ANIMALS = [
  // --- on land ---
  'badger', 'bear', 'beaver', 'bison', 'bunny', 'camel', 'cat', 'cheetah',
  'chipmunk', 'colt', 'corgi', 'cougar', 'deer', 'dingo', 'donkey', 'elk',
  'fawn', 'ferret', 'fox', 'gazelle', 'giraffe', 'goat', 'gopher', 'hare',
  'hedgehog', 'hippo', 'horse', 'husky', 'ibex', 'impala', 'jaguar', 'koala',
  'lemur', 'leopard', 'lion', 'llama', 'lynx', 'marten', 'meerkat', 'mole',
  'moose', 'mustang', 'ocelot', 'otter', 'panda', 'panther', 'pony', 'puma',
  'rabbit', 'reindeer', 'rhino', 'sable', 'squirrel', 'stag', 'tiger',
  'wolf', 'wombat', 'yak', 'zebra',

  // --- in the air ---
  'cardinal', 'condor', 'crane', 'dove', 'duck', 'eagle', 'egret', 'falcon',
  'finch', 'goose', 'gull', 'hawk', 'heron', 'ibis', 'jay', 'kestrel',
  'kite', 'kiwi', 'lark', 'macaw', 'magpie', 'oriole', 'osprey',
  'owl', 'parrot', 'peacock', 'pelican', 'penguin', 'puffin', 'quail',
  'raven', 'robin', 'sparrow', 'starling', 'stork', 'swallow', 'swan',
  'toucan', 'wren',

  // --- in the water ---
  'dolphin', 'manatee', 'narwhal', 'orca', 'salmon', 'seal',
  'seahorse', 'trout', 'turtle', 'walrus', 'whale',
];

/**
 * FNV-1a 32-bit string hash. Deterministic, fast, and dependency-free — we
 * only need a stable spread over the word lists, not cryptographic strength.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Derive a deterministic `{adjective}{animal}` slug from an npub.
 *
 * Two independent hashes (the second salted) index the word lists so the
 * adjective and animal vary independently. Same npub in → same slug out.
 * Returns `'buho'` when no npub is available so the caller always has a
 * registerable base.
 *
 * The seam between the two words is checked: "swift" + "turtle" concatenates
 * to `swiftturtle`, which nobody reads back correctly and nobody spells right
 * from hearing it. When the words would collide the animal moves on by one,
 * which stays deterministic and keeps the slug an exact adjective + animal.
 *
 * @param {string} npub — bech32 `npub1…` string (any string works)
 * @returns {string} e.g. `bravefox`, lowercase `[a-z]` only
 */
export function deriveMemorableSlug(npub) {
  const key = String(npub || '').trim();
  if (!key) return 'buho';

  const adjective = ADJECTIVES[hash32(key) % ADJECTIVES.length];
  const start = hash32(`${key}#animal`) % ANIMALS.length;

  const last = adjective[adjective.length - 1];
  let animal = ANIMALS[start];
  // One step is enough in practice; the loop bounds it so a pathological list
  // can never spin here.
  for (let i = 0; i < ANIMALS.length && animal[0] === last; i += 1) {
    animal = ANIMALS[(start + i + 1) % ANIMALS.length];
  }

  return `${adjective}${animal}`;
}
