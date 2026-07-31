package org.capacitor.quasar.app;

import android.os.SystemClock;

import java.util.UUID;

/**
 * NfcScanBuffer — one-shot handoff of an NFC scan from native dispatch to
 * JavaScript.
 *
 * NfcDispatchActivity captures the tag payload before the WebView exists (NFC
 * cold start) or while it is backgrounded. Pushing an event at that moment
 * can race the JS boot and lose the tap, so the payload is buffered here and
 * JavaScript PULLS it once it is ready (NfcPlugin.consumePendingScan, called
 * at boot and on every app resume).
 *
 * At-most-once semantics: consume() clears the buffer before returning, and a
 * stored scan overwrites any unconsumed predecessor (the newest tap wins).
 * The buffer is deliberately process-local, so a scan can never survive into
 * a later, unrelated app session; MAX_AGE_MS additionally bounds the window
 * between store and consume, using a monotonic clock that wall-time changes
 * cannot stretch.
 *
 * A successful system dispatch also arms a one-shot reader handoff guard. This
 * prevents the same physical tap from being read again when MainActivity
 * enables reader mode while the tag is still in the NFC field.
 */
final class NfcScanBuffer {

    /** Immutable snapshot of one captured scan. */
    static final class Scan {
        final String id;
        final String raw;
        final String source;
        final long capturedAtElapsedMs;

        private Scan(String raw, String source, long capturedAtElapsedMs) {
            this.id = UUID.randomUUID().toString();
            this.raw = raw;
            this.source = source;
            this.capturedAtElapsedMs = capturedAtElapsedMs;
        }
    }

    /** A scan older than this is stale — the user is no longer at the tag. */
    private static final long MAX_AGE_MS = 60_000;

    private static Scan pending;
    private static final NfcReaderHandoffGuard READER_HANDOFF_GUARD =
        new NfcReaderHandoffGuard();

    private NfcScanBuffer() {}

    static synchronized void store(String raw, String source) {
        long capturedAtElapsedMs = SystemClock.elapsedRealtime();
        pending = new Scan(raw, source, capturedAtElapsedMs);
        READER_HANDOFF_GUARD.arm(capturedAtElapsedMs);
    }

    /** Returns and clears the pending scan, or null when none is available. */
    static synchronized Scan consume() {
        Scan scan = pending;
        pending = null;
        if (scan == null) return null;
        if (SystemClock.elapsedRealtime() - scan.capturedAtElapsedMs > MAX_AGE_MS) return null;
        return scan;
    }

    /**
     * Returns true once during an active system-dispatch handoff window.
     * Called before any reader-mode tag IO so dynamic tags are not read twice.
     */
    static synchronized boolean consumeReaderHandoffGuard() {
        return READER_HANDOFF_GUARD.consumeIfActive(SystemClock.elapsedRealtime());
    }
}
