/**
 * Finishing username purchases, and keeping the shown username honest.
 *
 * Shared by `boot/nip05.js` (launch, return to the app, identity changes)
 * and the claim sheet, so a purchase finishes the same way whoever notices
 * the payment first. Every write of a username into the profile goes
 * through here, and only after the name server confirms the name points at
 * this identity's key.
 *
 * Stores are passed in rather than imported, so the flows can be tested
 * with real stores on an in-memory localStorage.
 */

import { checkPaid, expiresAtFor, lookupOwner, ownUsernameFrom } from './nip05.js';

/** An unpaid payment code is long expired after this; forget the claim. */
const UNPAID_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** A paid name that still points at no one after this is treated as lost. */
const ACTIVATION_GIVE_UP_MS = 24 * 60 * 60 * 1000;

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

let settling = null;

/**
 * Move the active identity's pending claim as far as it can go right now.
 * Single-flight: the sheet and the background upkeep can ask at the same
 * moment and share one answer, so a purchase is finished exactly once.
 *
 * @param {{ identity: object, profile: object, now?: number, api?: { checkPaid: Function, lookupOwner: Function } }} input
 * @returns {Promise<{ status: string, handle?: string, paid?: boolean }>}
 */
export function settlePendingClaim(input) {
  if (!settling) settling = settleOnce(input).finally(() => { settling = null; });
  return settling;
}

async function settleOnce({ identity, profile, now = Date.now(), api = { checkPaid, lookupOwner } }) {
  const claim = identity.pendingNip05Claim;
  if (!claim) return { status: CLAIM_STATUS.NONE };
  const { handle } = claim;
  if (claim.failedAt) return { status: CLAIM_STATUS.FAILED, handle };

  let { paidAt } = claim;
  if (!paidAt) {
    const paid = await api.checkPaid({ paymentHash: claim.paymentHash });
    if (paid !== true) {
      if (paid === false && now - claim.createdAt > UNPAID_GIVE_UP_MS) {
        identity.clearPendingNip05Claim();
        return { status: CLAIM_STATUS.EXPIRED, handle };
      }
      return { status: CLAIM_STATUS.WAITING, handle, paid: false };
    }
    paidAt = now;
    identity.updatePendingNip05Claim({ paidAt });
  }

  const owner = await api.lookupOwner(handle);
  if (owner === null) return { status: CLAIM_STATUS.WAITING, handle, paid: true };

  if (owner === identity.nostrPubkeyHex) {
    adoptOwnedUsername({
      identity,
      profile,
      handle,
      rotationSecret: claim.rotationSecret,
      addressId: claim.addressId,
      expiresAt: expiresAtFor(paidAt, claim.years),
    });
    identity.clearPendingNip05Claim();
    return { status: CLAIM_STATUS.DONE, handle };
  }

  // Paid, and the name points at no one yet: activation runs on the server
  // a moment after the payment, so keep waiting unless it never happened.
  if (owner === '' && now - paidAt <= ACTIVATION_GIVE_UP_MS) {
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

  const owner = await api.lookupOwner(local);
  if (owner === null) return 'unknown';
  if (owner === identity.nostrPubkeyHex) {
    identity.recordOwnedHandle({ handle: local });
    return 'mine';
  }
  if (owner === '' && identity.pendingNip05Claim?.handle === local) return 'pending';
  profile.markNip05NotMine();
  return 'not-mine';
}
