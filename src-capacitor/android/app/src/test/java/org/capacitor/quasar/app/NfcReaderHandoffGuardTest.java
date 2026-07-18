package org.capacitor.quasar.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NfcReaderHandoffGuardTest {

    @Test
    public void suppressesOnlyFirstReaderCallbackInsideWindow() {
        NfcReaderHandoffGuard guard = new NfcReaderHandoffGuard(5_000);

        guard.arm(10_000);

        assertTrue(guard.consumeIfActive(10_500));
        assertFalse(guard.consumeIfActive(10_600));
    }

    @Test
    public void doesNotSuppressReaderCallbackAfterWindowExpires() {
        NfcReaderHandoffGuard guard = new NfcReaderHandoffGuard(5_000);

        guard.arm(10_000);

        assertFalse(guard.consumeIfActive(15_001));
        assertFalse(guard.consumeIfActive(15_002));
    }

    @Test
    public void rearmingStartsANewHandoffWindow() {
        NfcReaderHandoffGuard guard = new NfcReaderHandoffGuard(5_000);

        guard.arm(10_000);
        assertTrue(guard.consumeIfActive(10_100));

        guard.arm(20_000);
        assertTrue(guard.consumeIfActive(20_100));
    }

    @Test
    public void doesNotSuppressWithoutSystemDispatch() {
        NfcReaderHandoffGuard guard = new NfcReaderHandoffGuard(5_000);

        assertFalse(guard.consumeIfActive(10_000));
    }
}
