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
   * Every seed-based wallet must be backed up for the wallet half to count as
   * done. A user with a backed-up Personal and an untouched Business is not
   * safe, and saying so is the entire point of this screen.
   */
  const walletWordsSaved = computed(() => {
    if (!hasWalletWords.value) return false;
    return seedWallets.value.every((w) => w?.metadata?.hasBackedUp === true);
  });

  /** 1 when the user only has card words, 2 when a wallet phrase exists too. */
  const phraseCount = computed(() => (hasWalletWords.value ? 2 : 1));

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
      route: null,
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
    if (!cardWordsSaved.value) return 'words-missing';
    if (!setupComplete.value) return 'steps-left';
    return 'ready';
  });

  return {
    identity,
    profile,
    ensureWalletLoaded,
    hasNameOrPhoto,
    cardWordsSaved,
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
