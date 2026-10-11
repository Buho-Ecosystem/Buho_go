/**
 * Changing the identity in use: switching to another one, creating a new one,
 * using one brought from another app. Identities are named by `key`: the
 * account number of one derived from the 12 words, or the id of an
 * external one.
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

  /** The store change that makes `key` the identity in use. */
  function changeTo(key) {
    return typeof key === 'number'
      ? () => identity.switchNostrIdentity(key)
      : () => identity.switchToExternalIdentity(key);
  }

  /** The identity is still on this phone's list (not removed or deleted meanwhile). */
  function stillListed(key) {
    return typeof key === 'number'
      ? !identity.nostrRemovedAccounts.includes(key)
      : identity.externalIdentities.some((e) => e.id === key);
  }

  /** @param {{ key: number|string, name: string, picture?: string }} target */
  async function switchAccount(target, { keepContacts = false } = {}) {
    switching.value = { name: target.name, picture: target.picture || '' };
    try {
      return await run({
        change: changeTo(target.key),
        keepContacts,
        failMessage: t("Couldn't switch identity"),
      });
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
   * @param {{ key: number|string, name: string, picture?: string }} target
   * @param {{ key: number|string, name: string, picture?: string }} previous
   * @param {{ keepContacts?: boolean }} [opts]  copy the current contacts along
   */
  async function switchTo(target, previous, opts = {}) {
    const outcome = await switchAccount(target, opts);
    if (!outcome.changed) return false;
    nowUsing(target.name, outcome.contactsLoaded, {
      timeout: 5000,
      actions: [{
        label: t('Undo'),
        color: 'white',
        handler: async () => {
          // Removed from this phone after the switch: going back would undo
          // that decision too.
          if (!stillListed(previous.key)) return;
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
