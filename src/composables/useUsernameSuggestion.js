/**
 * The calm "maria@mybuho.de is available" hint for someone without a
 * username, shared by the home tab's suggestion row and the Edit profile
 * row so both say the same thing.
 *
 * One search per display name per day (cached in `suggestUsernameFor`),
 * never while offline, never for someone who already has a username.
 */

import { ref, watch } from 'vue';
import { useProfileStore } from '../stores/profile';
import { suggestUsernameFor } from '../services/nip05';

export function useUsernameSuggestion() {
  const profile = useProfileStore();
  /** A local part known to be available right now, or ''. */
  const suggestedUsername = ref('');
  let latestName = '';

  async function refreshSuggestion() {
    const name = profile.displayName;
    latestName = name;
    if (!name || profile.username) {
      suggestedUsername.value = '';
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const result = await suggestUsernameFor(name);
    if (latestName !== name) return; // the name changed while we asked
    suggestedUsername.value = result?.available ? result.slug : '';
  }

  watch(() => [profile.displayName, profile.username], refreshSuggestion);

  return { suggestedUsername, refreshSuggestion };
}
