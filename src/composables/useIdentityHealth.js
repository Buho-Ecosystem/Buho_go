/**
 * Identity health.
 *
 * One source of truth for every place that reports "is this set up": the
 * ring on the card and the setup ladder. The old surface computed these
 * facts inline in several components and disagreed with itself.
 *
 * Backups are not setup. Their pending state belongs to the Security page
 * and the home keyring, both fed straight from the stores, so a finished
 * card never makes a claim about recovery words.
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
   * The wallet store only reads its blob from disk inside `initialize()`.
   * Screens that list recovery phrases, or sheets that read wallet state,
   * would otherwise see no wallets at all on a cold deep link. `initialize()`
   * is idempotent and single-flighted, so calling it here costs nothing when
   * the app is already up.
   */
  async function ensureWalletLoaded() {
    if (wallet.isInitialized) return;
    try {
      await wallet.initialize();
    } catch (err) {
      // A wallet that fails to come up is a wallet problem, not an identity
      // one. Reporting no wallet is the safe direction: it never claims a
      // phrase is saved when it is not.
      console.warn('[identity] wallet init failed, wallet state may be incomplete:', err);
    }
  }

  /** True once the user has given the card a name or a photo. */
  const hasNameOrPhoto = computed(() => !profile.isEmpty);

  /**
   * True once the identity phrase has been written down and verified. Not a
   * setup step any more, but the erase screen still needs it to warn when
   * there is genuinely no way back to a card.
   */
  const cardWordsSaved = computed(() => identity.backupConfirmed);

  /**
   * The setup ladder: one step, the photo and the name. A username is an
   * option, offered on its own once the name is set, and never a setup step;
   * adding an outside payment address is an option too, and backing up
   * lives in Security.
   */
  const steps = computed(() => [
    {
      id: 'profile',
      done: hasNameOrPhoto.value,
      label: 'Add a photo and your name',
      route: '/identity/profile',
    },
  ]);

  const stepsDone = computed(() => steps.value.filter((s) => s.done).length);
  const stepsTotal = computed(() => steps.value.length);
  const setupComplete = computed(() => stepsDone.value === stepsTotal.value);

  /** 0..1, drives the ring around the photo on the card. */
  const progress = computed(() =>
    stepsTotal.value ? stepsDone.value / stepsTotal.value : 1,
  );

  return {
    identity,
    profile,
    ensureWalletLoaded,
    hasNameOrPhoto,
    cardWordsSaved,
    steps,
    stepsDone,
    stepsTotal,
    setupComplete,
    progress,
  };
}
