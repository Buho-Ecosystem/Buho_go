/**
 * Changing the identity in use: switching to another one, creating a new one.
 *
 * Both go through the address book, which saves the outgoing identity's
 * contacts, changes the key, then loads the incoming identity's contacts;
 * after that the profile and the Social Bucket follow the new key. A switch
 * is reversible, so it happens on tap and offers Undo instead of asking
 * first.
 *
 * The change state is app-wide, not per page: only one identity change can
 * run at a time, and an Undo started from a toast after its page closed
 * still shows its progress (`switching`, for IdentitySwitchingDialog) on
 * whichever page is open.
 */
import { ref } from 'vue';
import { useQuasar } from 'quasar';
import { useIdentityStore } from '../stores/identity';
import { useProfileStore } from '../stores/profile';
import { useAddressBookStore } from '../stores/addressBook';
import { useSocialBucketStore } from '../stores/socialBucket';

const busy = ref(false);
/** @type {import('vue').Ref<{ name: string, picture?: string } | null>} */
const switching = ref(null);

/**
 * @param {(key: string, params?: object) => string} t  the caller's $t
 */
export function useIdentityChange(t) {
  const $q = useQuasar();
  const identity = useIdentityStore();
  const profile = useProfileStore();
  const addressBook = useAddressBookStore();
  const bucket = useSocialBucketStore();

  function notifyBusy() {
    $q.notify({
      type: 'info',
      message: t('Still finishing the last change'),
      caption: t('Try again in a moment.'),
      timeout: 3500,
    });
  }

  function notifyFailed(message, reason) {
    $q.notify({
      type: 'negative',
      message,
      caption: reason === 'flush-failed'
        ? t('Your contacts have not finished saving, so nothing was changed. Check your connection and try again.')
        : t('Check your connection and try again.'),
      timeout: 4500,
    });
  }

  /** The profile is scoped to a key: reset and refetch, as a restore does. */
  async function refreshForNewIdentity() {
    await profile.hydrate({ force: true });
    profile.recoverFromNostr({ identityStore: identity }).catch(() => {});
    bucket.hydrate({ pubkey: identity.nostrPubkeyHex })
      .then(() => bucket.sync({ identityStore: identity }))
      .catch(() => {});
  }

  /**
   * Run one identity change.
   *
   * The key can change even when the change as a whole reports a failure:
   * the address book flips the identity first and loads its contacts after.
   * So the outcome is read from the key, not from the result alone.
   *
   * @param {{ change: () => Promise<unknown>, keepContacts: boolean, failMessage: string }} opts
   * @returns {Promise<{ changed: boolean, contactsLoaded: boolean }>}
   */
  async function run({ change, keepContacts, failMessage }) {
    if (busy.value || bucket.isSweeping) {
      notifyBusy();
      return { changed: false, contactsLoaded: false };
    }
    busy.value = true;
    const keyBefore = identity.nostrPubkeyHex;
    try {
      const result = await addressBook.switchContactsIdentity({
        identityStore: identity,
        changeIdentity: change,
        keepContacts,
      });
      const changed = identity.nostrPubkeyHex !== keyBefore;
      if (changed) await refreshForNewIdentity();
      if (result === null) notifyBusy();
      else if (!changed) notifyFailed(failMessage, result.reason);
      return { changed, contactsLoaded: !!result?.ok };
    } catch (err) {
      console.warn('[identity-change] failed:', err);
      const changed = identity.nostrPubkeyHex !== keyBefore;
      if (changed) await refreshForNewIdentity().catch(() => {});
      else notifyFailed(failMessage);
      return { changed, contactsLoaded: false };
    } finally {
      busy.value = false;
    }
  }

  /** @param {{ account: number, name: string, picture?: string }} target */
  async function switchAccount(target) {
    switching.value = { name: target.name, picture: target.picture || '' };
    try {
      const outcome = await run({
        change: () => identity.switchNostrIdentity(target.account),
        keepContacts: false,
        failMessage: t("Couldn't switch identity"),
      });
      return outcome;
    } finally {
      switching.value = null;
    }
  }

  /** "Now using {name}", noting contacts that could not load yet. */
  function nowUsing(name, contactsLoaded, extra = {}) {
    $q.notify({
      message: t('Now using {name}', { name }),
      caption: contactsLoaded ? undefined : t('Your contacts load once you are back online.'),
      ...extra,
    });
  }

  /**
   * Switch to `target`, then offer Undo back to the identity that was in use.
   *
   * @param {{ account: number, name: string, picture?: string }} target
   * @param {{ account: number, name: string, picture?: string }} previous
   */
  async function switchTo(target, previous) {
    const outcome = await switchAccount(target);
    if (!outcome.changed) return false;
    nowUsing(target.name, outcome.contactsLoaded, {
      timeout: 5000,
      actions: [{
        label: t('Undo'),
        color: 'white',
        handler: async () => {
          // Removed from this phone after the switch: going back would undo
          // that decision too.
          if (identity.nostrRemovedAccounts.includes(previous.account)) return;
          const back = await switchAccount(previous);
          if (back.changed) nowUsing(previous.name, back.contactsLoaded, { timeout: 2500 });
        },
      }],
    });
    return true;
  }

  /** Create the next identity and make it the one in use. */
  async function create(keepContacts) {
    const outcome = await run({
      change: () => identity.createAnotherNostrIdentity(),
      keepContacts,
      failMessage: t("Couldn't create the identity"),
    });
    return outcome.changed;
  }

  return { busy, switching, switchTo, create };
}
