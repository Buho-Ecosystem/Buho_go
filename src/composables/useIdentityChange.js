/**
 * Changing the identity in use: switching to another one, creating a new one.
 *
 * Both go through the address book, which saves the outgoing identity's
 * contacts before the key changes, then refresh the profile and the Social
 * Bucket for the new key. A switch is reversible, so it happens on tap and
 * offers Undo instead of asking first; `switching` names the identity being
 * switched to while it runs, for IdentitySwitchingDialog.
 */
import { ref } from 'vue';
import { useQuasar } from 'quasar';
import { useIdentityStore } from '../stores/identity';
import { useProfileStore } from '../stores/profile';
import { useAddressBookStore } from '../stores/addressBook';
import { useSocialBucketStore } from '../stores/socialBucket';

/**
 * @param {(key: string, params?: object) => string} t  the caller's $t
 */
export function useIdentityChange(t) {
  const $q = useQuasar();
  const identity = useIdentityStore();
  const profile = useProfileStore();
  const addressBook = useAddressBookStore();
  const bucket = useSocialBucketStore();
  const busy = ref(false);
  /** @type {import('vue').Ref<{ name: string, picture?: string } | null>} */
  const switching = ref(null);

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
   * Run one identity change. Resolves true when the change landed; every
   * failure is reported here and leaves the identity as it was.
   *
   * @param {{ change: () => Promise<unknown>, keepContacts: boolean, failMessage: string }} opts
   */
  async function run({ change, keepContacts, failMessage }) {
    if (busy.value || bucket.isSweeping) return false;
    busy.value = true;
    try {
      const result = await addressBook.switchContactsIdentity({
        identityStore: identity,
        changeIdentity: change,
        keepContacts,
      });
      if (result === null) {
        $q.notify({
          type: 'info',
          message: t('Still finishing the last change'),
          caption: t('Try again in a moment.'),
          timeout: 3500,
        });
        return false;
      }
      if (!result.ok) {
        notifyFailed(failMessage, result.reason);
        return false;
      }
      await refreshForNewIdentity();
      return true;
    } catch (err) {
      console.warn('[identity-change] failed:', err);
      notifyFailed(failMessage);
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function switchAccount(target) {
    switching.value = { name: target.name, picture: target.picture || '' };
    try {
      return await run({
        change: () => identity.switchNostrIdentity(target.account),
        keepContacts: false,
        failMessage: t("Couldn't switch identity"),
      });
    } finally {
      switching.value = null;
    }
  }

  /**
   * Switch to `target`, then offer Undo back to the identity that was in use.
   *
   * @param {{ account: number, name: string, picture?: string }} target
   * @param {{ account: number, name: string, picture?: string }} previous
   * @param {() => void} [onChanged]  called after each landed change
   */
  async function switchTo(target, previous, onChanged = () => {}) {
    if (busy.value) return false;
    if (!await switchAccount(target)) return false;
    onChanged();
    $q.notify({
      message: t('Now using {name}', { name: target.name }),
      timeout: 5000,
      actions: [{
        label: t('Undo'),
        color: 'white',
        handler: async () => {
          if (!await switchAccount(previous)) return;
          onChanged();
          $q.notify({ message: t('Now using {name}', { name: previous.name }), timeout: 2500 });
        },
      }],
    });
    return true;
  }

  /** Create the next identity and make it the one in use. */
  function create(keepContacts) {
    return run({
      change: () => identity.createAnotherNostrIdentity(),
      keepContacts,
      failMessage: t("Couldn't create the identity"),
    });
  }

  return { busy, switching, switchTo, create };
}
