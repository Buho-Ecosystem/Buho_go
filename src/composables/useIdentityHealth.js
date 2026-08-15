/**
 * Identity health.
 *
 * One source of truth for every place that reports "is this set up, is this
 * safe": the ring on the card, the card's footer line, the setup ladder, and
 * the rows inside Manage identity. The old surface computed these facts
 * inline in three different components and disagreed with itself, which is
 * how a user could see a green "Backed up" tile while their identity phrase
 * had never been written down.
 *
 * The two-phrase problem lives here too. BuhoGO can hand a user two unrelated
 * twelve word phrases:
 *
 *   card words    the identity seed, brings back name, photo and contacts
 *   wallet words  a seed-based wallet's phrase, brings back the money
 *
 * A user with only NWC or LNbits wallets has no wallet words at all, so the
 * UI must be able to say "one phrase" as naturally as "two". `phraseCount`
 * is what every screen keys off rather than assuming a pair.
 */

import { computed } from 'vue';
import { useIdentityStore } from '../stores/identity';
import { useProfileStore } from '../stores/profile';
import { useWalletStore } from '../stores/wallet';

export function useIdentityHealth() {
  const identity = useIdentityStore();
  const profile = useProfileStore();
  const wallet = useWalletStore();

  /**
   * Any screen that reports the phrase count has to know whether a
   * seed-based wallet exists, and the wallet store only reads its blob from
   * disk inside `initialize()`. A user who deep-links straight into the
   * identity tab on a cold start would otherwise be told they have one
   * phrase when they have two, which is the exact error this whole screen
   * exists to prevent. `initialize()` is idempotent and single-flighted, so
   * calling it here costs nothing when the app is already up.
   */
  async function ensureWalletLoaded() {
    if (wallet.isInitialized) return;
    try {
      await wallet.initialize();
    } catch (err) {
      // A wallet that fails to come up is a wallet problem, not an identity
      // one. The phrase count degrades to "card words only", which is the
      // safe direction: it never claims a phrase is saved when it is not.
      console.warn('[identity] wallet init failed, phrase count may be incomplete:', err);
    }
  }

  /** True once the user has given the card a name or a photo. */
  const hasNameOrPhoto = computed(() => !profile.isEmpty);

  /** True once the identity phrase has been written down and verified. */
  const cardWordsSaved = computed(() => identity.backupConfirmed);

  /**
   * Wallets whose recovery is a phrase. NWC and LNbits connections are not
   * restored from words, so they never contribute a second phrase.
   */
  const seedWallets = computed(() =>
    (wallet.wallets || []).filter((w) => w.type === 'spark' || w.type === 'arkade'),
  );

  const hasWalletWords = computed(() => seedWallets.value.length > 0);

  /**
   * One entry per distinct set of wallet words, not per wallet.
   *
   * Spark wallets share a single mnemonic (`confirmBackup` marks them all
   * together), so however many there are they are one paper. Arkade is a
   * separate backend with its own phrase, and a user with both genuinely has
   * three sets of words counting the card. The screen used to assume exactly
   * one wallet phrase, so it showed two papers to someone holding three and
   * gave them a single saved state covering both.
   */
  const walletPhrases = computed(() => {
    const all = wallet.wallets || [];
    const out = [];

    const spark = all.filter((w) => w.type === 'spark');
    if (spark.length) {
      out.push({
        id: 'spark',
        walletId: spark[0].id,
        restores: spark.length > 1 ? 'sparkMany' : 'sparkOne',
        saved: spark.every((w) => w?.metadata?.hasBackedUp === true),
      });
    }

    for (const ark of all.filter((w) => w.type === 'arkade')) {
      out.push({
        id: `arkade:${ark.id}`,
        walletId: ark.id,
        name: ark.name || '',
        restores: 'arkade',
        saved: ark?.metadata?.hasBackedUp === true,
      });
    }

    return out;
  });

  /**
   * Every seed-based wallet must be backed up for the wallet half to count as
   * done. A user with a backed-up Personal and an untouched Business is not
   * safe, and saying so is the entire point of this screen.
   */
  const walletWordsSaved = computed(() => {
    if (!hasWalletWords.value) return false;
    return walletPhrases.value.every((p) => p.saved);
  });

  /** The card words, plus one per distinct wallet phrase. */
  const phraseCount = computed(() => 1 + walletPhrases.value.length);

  /** True when every phrase the user has is written down. */
  const allWordsSaved = computed(
    () => cardWordsSaved.value && (!hasWalletWords.value || walletWordsSaved.value),
  );

  /**
   * The setup ladder. Three steps, not four: buying a username and adding an
   * outside payment address are options, not setup. The first step is already
   * done by the time the user ever sees this, which is deliberate. People
   * finish a list that has started far more often than one that has not.
   */
  const steps = computed(() => [
    {
      id: 'username',
      done: !!identity.nip05ActiveEntry,
      label: 'Your name is reserved',
      route: '/identity/username',
    },
    {
      id: 'profile',
      done: hasNameOrPhoto.value,
      label: 'Add a photo and your name',
      route: '/identity/profile',
    },
    {
      id: 'words',
      done: cardWordsSaved.value,
      label: 'Save your 12 words',
      route: '/identity/words',
    },
  ]);

  const stepsDone = computed(() => steps.value.filter((s) => s.done).length);
  const stepsTotal = computed(() => steps.value.length);
  const setupComplete = computed(() => stepsDone.value === stepsTotal.value);

  /** 0..1, drives the ring around the photo on the card. */
  const progress = computed(() =>
    stepsTotal.value ? stepsDone.value / stepsTotal.value : 1,
  );

  /**
   * The card's footer. Reports the single most useful fact for the current
   * state, in words. Deliberately never coloured: the surface has no amber
   * dot and no red banner anywhere.
   */
  const statusKey = computed(() => {
    if (!identity.bootstrapped) return 'setting-up';

    // Progress before reprimand. Testing the words first made 'steps-left'
    // unreachable, so a brand-new card's very first line was a warning about
    // "12 words" — a term the user first meets three lines further down the
    // same screen. Ordering it the other way round instead would kill
    // 'words-missing', because saving the words IS the last step, so
    // setupComplete already implies it.
    //
    // What the card should say is what is actually left: a count while
    // several things are outstanding, and the words by name once they are
    // the only thing standing between the user and a finished card.
    if (!setupComplete.value) {
      const remaining = stepsTotal.value - stepsDone.value;
      if (remaining === 1 && !cardWordsSaved.value) return 'words-missing';
      return 'steps-left';
    }
    // "Ready" has to mean every phrase this user has is written down. Saying
    // it while the wallet words are still outstanding is the exact false
    // reassurance the two-phrase screen exists to prevent, and the card is
    // the most visible place in the app to say it.
    if (hasWalletWords.value && !walletWordsSaved.value) return 'wallet-words-missing';
    return 'ready';
  });

  return {
    identity,
    profile,
    ensureWalletLoaded,
    hasNameOrPhoto,
    cardWordsSaved,
    walletPhrases,
    walletWordsSaved,
    hasWalletWords,
    phraseCount,
    allWordsSaved,
    steps,
    stepsDone,
    stepsTotal,
    setupComplete,
    progress,
    statusKey,
  };
}
