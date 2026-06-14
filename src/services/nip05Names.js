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
 * Pure module — no store/Pinia imports — so it can be unit-tested directly.
 */

export const ADJECTIVES = [
  // --- positive / energetic ---
  'bold', 'brave', 'bright', 'calm', 'clear', 'cool', 'crisp', 'deft',
  'eager', 'fair', 'fast', 'fine', 'firm', 'fond', 'free', 'fresh',
  'glad', 'gold', 'good', 'grand', 'great', 'green', 'happy', 'keen',
  'kind', 'light', 'live', 'lucky', 'mild', 'mint', 'neat', 'nice',
  'noble', 'open', 'prime', 'proud', 'pure', 'quick', 'rapid', 'rare',
  'rich', 'safe', 'sharp', 'sleek', 'smart', 'smooth', 'snug', 'solid',
  'sonic', 'spark', 'steel', 'still', 'stone', 'storm', 'sunny', 'super',
  'sure', 'sweet', 'swift', 'tall', 'tidy', 'true', 'trust', 'vast',
  'vivid', 'warm', 'white', 'wide', 'wild', 'wise', 'young', 'zen',
  // --- nature / elements ---
  'agile', 'amber', 'azure', 'blaze', 'cedar', 'civic', 'coral', 'creek',
  'dawn', 'deep', 'dune', 'echo', 'edge', 'elite', 'ember', 'epic',
  'ever', 'frost', 'glow', 'grove', 'haven', 'ivory', 'jade', 'jewel',
  'lunar', 'maple', 'neon', 'nova', 'ocean', 'onyx', 'opal', 'peak',
  'pixel', 'polar', 'prism', 'quest', 'ridge', 'river', 'royal', 'ruby',
  'sage', 'silk', 'silver', 'solar', 'terra', 'titan', 'ultra', 'unity',
  'upper', 'valor', 'velvet', 'vigor', 'vital', 'north', 'south', 'west',
  // --- expanded set ---
  'able', 'acorn', 'adept', 'airy', 'alert', 'alive', 'ample', 'apt',
  'arch', 'arid', 'astral', 'atlas', 'atom', 'avid', 'awake', 'aware',
  'basic', 'birch', 'bloom', 'blue', 'bliss', 'blush', 'boreal', 'bound',
  'brisk', 'broad', 'bronze', 'brook', 'built', 'burly', 'canny', 'cape',
  'chief', 'cinch', 'clad', 'clan', 'clay', 'cliff', 'cloud', 'clove',
  'coast', 'comet', 'core', 'cozy', 'craft', 'crest', 'crown', 'cubic',
  'daily', 'daring', 'delta', 'dense', 'dewy', 'direct', 'dream', 'drift',
  'dual', 'dusky', 'dusty', 'early', 'earth', 'easy', 'eight', 'elm',
  'equal', 'even', 'exact', 'extra', 'fable', 'facet', 'faith', 'famed',
  'fancy', 'fern', 'fiery', 'first', 'fixed', 'flame', 'flash', 'fleet',
  'flint', 'flora', 'fluid', 'focal', 'forge', 'forte', 'found', 'frank',
  'full', 'gamma', 'gaze', 'gem', 'giant', 'given', 'gleam',
  'glide', 'globe', 'grace', 'grain', 'graph', 'grass', 'gray', 'grey',
  'grind', 'guard', 'guide', 'gust', 'hale', 'hardy', 'hazel', 'heart',
  'hefty', 'henna', 'hero', 'hilly', 'hive', 'holly', 'honey', 'honor',
  'hope', 'humid', 'hyper', 'ideal', 'indie', 'inner', 'ionic', 'iron',
  'isle', 'jet', 'jolly', 'jovial', 'jumbo', 'just', 'karma', 'kelp',
  'knack', 'known', 'laced', 'lapis', 'latch', 'latte', 'leafy', 'lean',
  'level', 'lilac', 'linen', 'lithe', 'lit', 'lofty', 'lone', 'lotus',
  'lush', 'lyric', 'magic', 'major', 'mango', 'manor', 'march', 'marsh',
  'matte', 'maven', 'max', 'meek', 'mega', 'mercy', 'merit', 'merry',
  'mesa', 'metal', 'metro', 'micro', 'might', 'modal', 'mocha', 'modern',
  'mood', 'moon', 'moral', 'mossy', 'motif', 'mover', 'much', 'muse',
  'nano', 'navy', 'nerve', 'next', 'nimble', 'ninth', 'nitro', 'noted',
  'novel', 'oaken', 'olive', 'omega', 'only', 'orbit', 'order', 'outer',
  'oxide', 'pace', 'palm', 'panel', 'paper', 'patch', 'pearl', 'petal',
  'phase', 'pilot', 'pine', 'pink', 'pivot', 'plain', 'plush', 'point',
  'polite', 'poppy', 'port', 'power', 'prank', 'press', 'presto', 'price',
  'primo', 'print', 'prize', 'proof', 'pulse', 'quartz', 'queen', 'quiet',
  'quote', 'radial', 'rain', 'rally', 'ranch', 'range', 'ready', 'realm',
  'reef', 'regal', 'relay', 'remix', 'retro', 'right', 'risen', 'roast',
  'rocky', 'rogue', 'root', 'rosy', 'round', 'route', 'rover', 'rustic',
  'sable', 'sandy', 'satin', 'savvy', 'scenic', 'scope', 'scout', 'seed',
  'serene', 'seven', 'shade', 'shelf', 'shell', 'shield', 'shift', 'shore',
  'sigma', 'sign', 'sixth', 'slate', 'slice', 'slim', 'slope', 'snow',
  'sober', 'soft', 'soma', 'sound', 'space', 'span', 'spice', 'spine',
  'spoke', 'sport', 'spray', 'sprig', 'spring', 'squad', 'stage', 'stamp',
  'star', 'stark', 'stead', 'stem', 'step', 'stock', 'stoic', 'stout',
  'straw', 'strip', 'stud', 'style', 'suave', 'sum', 'surge', 'swirl',
  'tango', 'teal', 'tempo', 'tenth', 'theta', 'third', 'thorn', 'three',
  'tide', 'timber', 'toast', 'token', 'tonic', 'topaz', 'torch', 'total',
  'tower', 'trace', 'trail', 'trend', 'triad', 'tribe', 'trim', 'triple',
  'tropic', 'tulip', 'tuned', 'turbo', 'twice', 'twin', 'typed', 'umbra',
  'union', 'urban', 'valid', 'valve', 'vault', 'vegan', 'venus', 'verge',
  'verse', 'vibe', 'view', 'vinyl', 'viola', 'vocal', 'volt',
  'vortex', 'warp', 'watch', 'wave', 'wax', 'whole', 'windy', 'wired',
  'witty', 'woven', 'xenon', 'yield', 'zero', 'zesty', 'zinc', 'zone', 'zonal',
];

export const ANIMALS = [
  // --- common / short ---
  'ant', 'ape', 'bat', 'bear', 'bee', 'bird', 'bull', 'cat',
  'colt', 'crab', 'crow', 'deer', 'dove', 'duck', 'eagle', 'elk',
  'fawn', 'fish', 'fox', 'frog', 'goat', 'hawk', 'hare', 'hen',
  'horse', 'ibis', 'jay', 'koi', 'lark', 'lion', 'lynx', 'mole',
  'moth', 'mule', 'newt', 'orca', 'owl', 'panda', 'pike', 'pony',
  'puma', 'ram', 'raven', 'robin', 'seal', 'shark', 'snake', 'stag',
  'swan', 'tiger', 'toad', 'trout', 'viper', 'wasp', 'whale', 'wolf',
  'wren', 'yak', 'zebra', 'cobra', 'crane', 'dingo', 'drake', 'egret',
  'finch', 'gecko', 'grouse', 'gull', 'husky', 'iguana', 'jackal', 'koala',
  'lemur', 'llama', 'macaw', 'moose', 'otter', 'parrot', 'quail', 'rhino',
  'rook', 'snail', 'stoat', 'tern', 'toucan', 'turtle', 'chimp', 'bison',
  'coyote', 'falcon', 'ferret', 'heron', 'mantis', 'osprey', 'panther',
  'pelican', 'pigeon', 'python', 'salmon', 'squid', 'wombat', 'badger', 'beetle',
  // --- expanded set ---
  'adder', 'albatross', 'alpaca', 'anchovy', 'angelfish', 'antelope', 'armadillo',
  'baboon', 'barb', 'bass', 'beagle', 'beaver', 'bluejay', 'bobcat',
  'boar', 'bongo', 'bunny', 'camel', 'canary', 'cardinal', 'caribou', 'catfish',
  'cheetah', 'cicada', 'clam', 'cockatoo', 'cod', 'condor', 'conch', 'corgi',
  'cougar', 'coypu', 'cricket', 'curlew', 'darter', 'dhole', 'dodo',
  'dolphin', 'donkey', 'dormouse', 'drongo', 'dugong', 'dunlin',
  'eel', 'eland', 'ermine', 'flamingo', 'flounder', 'flybird',
  'gannet', 'gar', 'gazelle', 'gerbil', 'gibbon', 'giraffe', 'goldfinch',
  'goose', 'gopher', 'gorilla', 'grebe', 'grizzly', 'grouper', 'gryphon',
  'guppy', 'hamster', 'harrier', 'hedgehog', 'hermit', 'hippo', 'hoopoe',
  'hornet', 'hound', 'hummingbird', 'hyena', 'impala', 'indri', 'jackdaw',
  'jaguar', 'jaybird', 'jellyfish', 'jerboa', 'junco', 'kestrel', 'kingbird',
  'kingfish', 'kite', 'kiwi', 'kudu', 'limpet', 'lizard', 'lobster', 'locust',
  'loon', 'loris', 'magpie', 'mamba', 'manatee', 'marlin', 'marmot', 'marten',
  'meadowlark', 'meerkat', 'merlin', 'mink', 'minnow', 'mockingbird', 'monarch',
  'mongoose', 'monitor', 'monkey', 'moorhen', 'mudlark', 'mullet', 'mustang',
  'narwhal', 'nightjar', 'numbat', 'ocelot', 'octopus', 'okapi', 'opossum',
  'oriole', 'ostrich', 'oyster', 'paddlefish', 'pangolin', 'parakeet', 'partridge',
  'peacock', 'penguin', 'perch', 'pheasant', 'piranha', 'plover', 'polecat',
  'poodle', 'porcupine', 'porpoise', 'possum', 'prawn', 'puffin', 'rabbit',
  'raccoon', 'racer', 'raptor', 'rattler', 'redbird', 'reindeer', 'roadrunner',
  'rooster', 'sailfish', 'sandpiper', 'sawfish', 'seahorse', 'serval', 'shrike',
  'skipper', 'skylark', 'sloth', 'sparrow', 'spider', 'starfish', 'starling',
  'stingray', 'stork', 'sturgeon', 'sunbird', 'sunfish', 'swallow', 'taipan',
  'tamarin', 'tapir', 'tarpon', 'termite', 'thrush', 'titmouse', 'tortoise',
  'treefrog', 'tuna', 'turnstone', 'urchin', 'vicuna', 'vole', 'vulture',
  'wallaby', 'walrus', 'warbler', 'warthog', 'weasel', 'weaver', 'whippet',
  'wildcat', 'wolverine', 'woodpecker', 'yapok', 'zebrafish',
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
 * @param {string} npub — bech32 `npub1…` string (any string works)
 * @returns {string} e.g. `bravefox`, lowercase `[a-z]` only
 */
export function deriveMemorableSlug(npub) {
  const key = String(npub || '').trim();
  if (!key) return 'buho';
  const adjective = ADJECTIVES[hash32(key) % ADJECTIVES.length];
  const animal = ANIMALS[hash32(`${key}#animal`) % ANIMALS.length];
  return `${adjective}${animal}`;
}
