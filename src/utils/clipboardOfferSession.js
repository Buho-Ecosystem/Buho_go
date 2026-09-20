const MIN_ABSENCE_MS = 1500;
const READ_DELAY_MS = 350;
const READ_RETRY_MS = 900;

/**
 * One clipboard check per Android app start or return, shared across Home
 * mounts. A completed read waits for a visible, unlocked Home before it is
 * consumed. This also avoids another platform clipboard notice on navigation.
 */
export function createClipboardOfferSession({
  read,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  let owner = null;
  let active = true;
  let inactiveSince = null;
  let pending = true;
  let reading = false;
  let generation = 0;
  // undefined: not read yet; null: unavailable; string: a successful read.
  let result;

  const canOffer = () => active && owner?.canOffer();

  async function check() {
    if (!pending || reading || !canOffer()) return;
    reading = true;
    const currentGeneration = generation;
    const canRead = () => currentGeneration === generation && canOffer();
    try {
      if (result === undefined) {
        // Android's window focus can lag the resume event.
        await wait(READ_DELAY_MS);
        if (!canRead()) return;
        let text = await read();
        if (!text) {
          await wait(READ_RETRY_MS);
          if (!canRead()) return;
          text = await read();
        }
        if (currentGeneration === generation) result = text ?? null;
      }
      if (!canRead()) return;
      const target = owner;
      const stillVisible = () => owner === target && canRead();
      // offer resolves after Vue has rendered, or returns false if interrupted.
      const consumed = result === null || await target.offer(result, stillVisible);
      if (consumed && currentGeneration === generation) {
        pending = false;
        result = undefined;
      }
    } catch {
      if (currentGeneration === generation) result = null;
    } finally {
      reading = false;
      // The owner may have changed while awaiting the native bridge.
      // Only its current, visible replacement may consume the result.
      void check();
    }
  }

  return {
    check,
    attach(nextOwner) {
      owner = nextOwner;
      void check();
    },
    detach(previousOwner) {
      if (owner === previousOwner) owner = null;
    },
    setActive(isActive) {
      if (active === isActive) return;
      active = isActive;
      if (!active) {
        inactiveSince = now();
        generation += 1;
        result = undefined;
        owner?.dismiss();
        return;
      }
      if (inactiveSince !== null && now() - inactiveSince >= MIN_ABSENCE_MS) pending = true;
      inactiveSince = null;
      void check();
    },
  };
}
