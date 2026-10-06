/**
 * Finishing username purchases, and keeping the shown username honest.
 *
 * Called by the profile sync lifecycle, independent of the purchase UI.
 * A username is adopted only after the name server confirms ownership.
 *
 * Stores are passed in rather than imported, so the flows can be tested
 * with real stores on an in-memory localStorage.
 */

import { checkPaid, expiresAtFor, lookupOwner, ownUsernameFrom } from './nip05.js';

/** An unpaid payment code is long expired after this; forget the claim. */
const UNPAID_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export const CLAIM_STATUS = Object.freeze({
  /** No claim waiting for this identity. */
  NONE: 'none',
  /** Not paid yet, or paid and not active yet, or the server was unreachable. */
  WAITING: 'waiting',
  /** The name is this identity's and is now on the profile. */
  DONE: 'done',
  /** Paid, but the name went to someone else first. */
  FAILED: 'failed',
  /** Never paid; the claim was forgotten. */
  EXPIRED: 'expired',
});

/**
 * Put a confirmed name on the profile and in this phone's purchase record.
 * The one writer of a username; callers must have confirmed ownership.
 */
export function adoptOwnedUsername({ identity, profile, handle, rotationSecret = null, addressId = null, expiresAt = null }) {
  // Record first: the profile write wakes the boot upkeep, which then finds
  // the name already known and makes no network call.
  identity.recordOwnedHandle({ handle, rotationSecret, addressId, expiresAt });
  profile.setUsername(handle);
}

/** Explicit, no-charge recovery/selection of a name, reverified at action time. */
export async function useOwnedUsername({ identity, profile, handle, api = { lookupOwner } }) {
  const scope = profile.captureSession();
  const revision = profile.revision;
  const owner = await api.lookupOwner(handle);
  if (!scope.current() || profile.revision !== revision) return null;
  if (owner !== scope.pubkey) return false;
  adoptOwnedUsername({ identity, profile, handle, expiresAt: identity.usernameExpiresAt(handle) });
  return true;
}

let claimViews = 0;

/**
 * Tell the background upkeep that a screen is showing the claim's outcome
 * itself (the claim sheet), so it does not toast the same news on top.
 *
 * @returns {() => void} call to release
 */
export function holdClaimInView() {
  claimViews += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claimViews -= 1;
  };
}

/** True while a screen shows the claim's outcome itself. */
export function claimIsInView() {
  return claimViews > 0;
}

const settling = new WeakMap();

/**
 * Move the active identity's pending claim as far as it can go right now.
 * Single-flight per store, account session and invoice. Late answers cannot
 * mutate an identity that became active while the request was in flight.
 *
 * @param {{ identity: object, profile: object, now?: number, api?: { checkPaid: Function, lookupOwner: Function } }} input
 * @returns {Promise<{ status: string, handle?: string, paid?: boolean }>}
 */
export function settlePendingClaim(input) {
  const { identity, profile } = input;
  let flights = settling.get(identity);
  if (!flights) settling.set(identity, flights = new Map());
  const key = `${identity.nostrPubkeyHex}:${profile.session}:${identity.pendingNip05Claim?.paymentHash}`;
  if (!flights.has(key)) flights.set(key, settleOnce(input).finally(() => flights.delete(key)));
  return flights.get(key);
}

async function settleOnce({ identity, profile, now = Date.now(), api = { checkPaid, lookupOwner } }) {
  const claim = identity.pendingNip05Claim;
  if (!claim) return { status: CLAIM_STATUS.NONE };
  const { handle } = claim;
  if (claim.failedAt) return { status: CLAIM_STATUS.FAILED, handle };
  const scope = profile.captureSession();
  const current = () => scope.current() && identity.pendingNip05Claim?.paymentHash === claim.paymentHash;
  const waiting = () => ({ status: CLAIM_STATUS.WAITING, handle, paid: !!claim.paidAt });

  // The profile and receipt were committed before the claim could be cleared.
  // Do not replay that selection over a later edit after a crash/restart.
  if (profile.lastUsernameClaim === claim.paymentHash) {
    identity.clearPendingNip05Claim();
    return { status: CLAIM_STATUS.DONE, handle };
  }

  let { paidAt } = claim;
  if (!paidAt) {
    const paid = await api.checkPaid({ paymentHash: claim.paymentHash });
    if (!current()) return waiting();
    paidAt = identity.pendingNip05Claim.paidAt;
    if (paid !== true && !paidAt) {
      if (paid === false && now - claim.createdAt > UNPAID_GIVE_UP_MS) {
        identity.clearPendingNip05Claim();
        return { status: CLAIM_STATUS.EXPIRED, handle };
      }
      return { status: CLAIM_STATUS.WAITING, handle, paid: false };
    }
    if (!paidAt) {
      paidAt = now;
      identity.updatePendingNip05Claim({ paidAt });
    }
  }

  const owner = await api.lookupOwner(handle);
  if (!current()) return waiting();
  if (owner === null) return { status: CLAIM_STATUS.WAITING, handle, paid: true };

  if (owner === identity.nostrPubkeyHex) {
    identity.recordOwnedHandle({
      handle,
      rotationSecret: claim.rotationSecret,
      addressId: claim.addressId,
      expiresAt: expiresAtFor(paidAt, claim.years),
    });
    // A deliberate selection/removal made since checkout wins. Legacy claims
    // lack a baseline, so only fill an empty value or confirm the same name.
    const unchanged = claim.usernameRevision === null
      ? profile.usernameRevision === 0
      : profile.usernameRevision === claim.usernameRevision;
    // Recovery of historical metadata is not a choice made after checkout.
    // Use the version that changed nip05, not a later publication of other fields.
    const historical = profile.usernameVersion.event?.created_at < Math.floor(claim.createdAt / 1000);
    const select = profile.username === handle || (unchanged || historical)
      && (claim.usernameRevision !== null || !profile.nip05);
    profile.acceptUsernameClaim(handle, claim.paymentHash, { select });
    identity.clearPendingNip05Claim();
    return { status: CLAIM_STATUS.DONE, handle };
  }

  // Paid, and the name points at no one yet: activation runs on the server
  // a moment after the payment. A delay alone is not evidence of lost ownership.
  if (owner === '') {
    return { status: CLAIM_STATUS.WAITING, handle, paid: true };
  }

  identity.updatePendingNip05Claim({ failedAt: now });
  return { status: CLAIM_STATUS.FAILED, handle };
}

/**
 * Check a username the profile carries but this phone never recorded, for
 * example one written by another Nostr app. Mine: record it. Someone
 * else's, or no one's: mark it so it is never shown as this person's
 * username. Unanswerable: leave it for next time.
 *
 * @returns {Promise<'none'|'known'|'mine'|'not-mine'|'pending'|'unknown'>}
 */
export async function reconcileProfileUsername({ identity, profile, api = { lookupOwner } }) {
  const local = ownUsernameFrom(profile.nip05);
  if (!local) return 'none';
  if (profile.nip05NotMine === profile.nip05) return 'not-mine';
  if (identity.nip05Handles.some((entry) => entry.handle === local)) return 'known';

  const scope = profile.captureSession();
  const value = profile.nip05;
  const owner = await api.lookupOwner(local);
  if (!scope.current() || profile.nip05 !== value) return 'unknown';
  if (owner === null) return 'unknown';
  if (owner === identity.nostrPubkeyHex) {
    identity.recordOwnedHandle({ handle: local });
    return 'mine';
  }
  if (owner === '' && identity.pendingNip05Claim?.handle === local) return 'pending';
  profile.markNip05NotMine();
  return 'not-mine';
}
