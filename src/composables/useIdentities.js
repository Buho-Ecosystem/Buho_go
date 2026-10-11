/**
 * The identities on this phone, ready to display.
 *
 * Rows come from the identity store's roster (removed identities excluded),
 * named and pictured from each identity's saved profile first, then from the
 * profiles the relays return. The identity in use reads the live profile
 * store, so an edit shows here at once.
 */
import { ref } from 'vue';
import { useIdentityStore } from '../stores/identity';
import { useProfileStore } from '../stores/profile';
import { fetchProfiles, parseProfileContent } from '../utils/nostrFetch.js';
import { nip05AddressFor, ownUsernameFrom } from '../services/nip05.js';

/** Full `maria@mybuho.de` for a username, or ''. */
export function addressFor(username) {
  return nip05AddressFor(username) || '';
}

/**
 * Short form of a public code, enough to tell two identities apart:
 * `npub1x8k…3fd2`. The full value is what gets copied.
 */
export function shortPublicCode(npub) {
  return npub ? `${npub.slice(0, 8)}…${npub.slice(-4)}` : '';
}

function readCachedProfile(pubkeyHex) {
  if (!pubkeyHex) return {};
  try {
    const raw = localStorage.getItem(`buhoGO_profile_v1_${pubkeyHex}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.version === 1 ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {(key: string, params?: object) => string} t  the caller's $t
 */
export function useIdentities(t) {
  const identity = useIdentityStore();
  const profile = useProfileStore();
  const identities = ref([]);

  /** The live profile owns the identity in use; saved data covers the rest. */
  function decorate(row, fetched = {}) {
    const cached = readCachedProfile(row.pubkeyHex);
    if (row.active) {
      return {
        ...row,
        displayName: profile.displayName || profile.name || fetched.display_name || fetched.name || cached.displayName || '',
        picture: profile.picture || fetched.picture || cached.picture || '',
        username: profile.username,
      };
    }
    return {
      ...row,
      displayName: fetched.display_name || fetched.name || cached.displayName || cached.name || '',
      picture: fetched.picture || cached.picture || '',
      // The published profile is the source of truth for a username; the
      // saved copy covers an identity the relays did not return.
      username: ownUsernameFrom(fetched.nip05) || profile.savedUsernameFor(row.pubkeyHex),
    };
  }

  async function refresh() {
    let rows;
    try {
      rows = await identity.listNostrIdentities();
    } catch (err) {
      console.warn('[identities] listing failed:', err);
      identities.value = [];
      return;
    }
    identities.value = rows.map((row) => decorate(row));

    const pubkeys = rows.map((row) => row.pubkeyHex).filter(Boolean);
    if (!pubkeys.length) return;
    try {
      const profiles = await fetchProfiles(pubkeys);
      identities.value = rows.map((row) => decorate(
        row,
        parseProfileContent(profiles.get((row.pubkeyHex || '').toLowerCase())),
      ));
    } catch (err) {
      console.warn('[identities] profile fetch failed:', err);
    }
  }

  /** A display name, then a label, then the username, then a numbered fallback. */
  function nameOf(row) {
    if (!row) return '';
    if (row.displayName) return row.displayName;
    if (row.label) return row.label;
    if (row.username) return addressFor(row.username);
    return t('Identity {n}', { n: row.account + 1 });
  }

  /**
   * The one identifier line under a name: the username, else the short
   * public code (also when the username already is the name).
   */
  function captionOf(row) {
    const address = row?.username ? addressFor(row.username) : '';
    return address && address !== nameOf(row)
      ? { text: address, mono: false }
      : { text: shortPublicCode(row?.npub), mono: true };
  }

  return { identities, refresh, nameOf, captionOf };
}
