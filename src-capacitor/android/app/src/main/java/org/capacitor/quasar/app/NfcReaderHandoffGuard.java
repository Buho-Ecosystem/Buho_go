package org.capacitor.quasar.app;

/**
 * Suppresses the one reader-mode callback that can follow an Android NDEF
 * dispatch for the same physical tap.
 *
 * Starting MainActivity after a system dispatch enables reader mode again. If
 * the original tag is still in the NFC field, Android may immediately report
 * it through ReaderCallback as well. Payload-based deduplication is unsuitable
 * because dynamic tags such as NTAG 424 DNA can produce a new URL on each read.
 *
 * The guard is one-shot and short-lived: the first callback inside the handoff
 * window is suppressed and consumes the guard. Later foreground scans are not
 * affected.
 */
final class NfcReaderHandoffGuard {

    static final long DEFAULT_WINDOW_MS = 5_000;

    private static final long NOT_ARMED = -1;

    private final long windowMs;
    private long armedAtElapsedMs = NOT_ARMED;

    NfcReaderHandoffGuard() {
        this(DEFAULT_WINDOW_MS);
    }

    NfcReaderHandoffGuard(long windowMs) {
        if (windowMs <= 0) {
            throw new IllegalArgumentException("windowMs must be positive");
        }
        this.windowMs = windowMs;
    }

    synchronized void arm(long elapsedMs) {
        armedAtElapsedMs = elapsedMs;
    }

    synchronized boolean consumeIfActive(long elapsedMs) {
        long armedAt = armedAtElapsedMs;
        armedAtElapsedMs = NOT_ARMED;
        if (armedAt == NOT_ARMED) return false;

        long ageMs = elapsedMs - armedAt;
        return ageMs >= 0 && ageMs <= windowMs;
    }
}
