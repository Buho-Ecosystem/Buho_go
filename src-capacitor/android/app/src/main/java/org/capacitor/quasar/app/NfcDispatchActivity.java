package org.capacitor.quasar.app;

import android.app.Activity;
import android.content.Intent;
import android.nfc.NdefMessage;
import android.nfc.NfcAdapter;
import android.os.Bundle;
import android.os.Parcelable;
import android.util.Log;

import java.util.Locale;

/**
 * NfcDispatchActivity — BuhoGO's only receiver of system NFC intents.
 *
 * It exists so that a tag tapped while the app is closed or backgrounded can
 * reach BuhoGO through Android's NFC app picker, without wiring NFC into the
 * launcher activity. Keeping MainActivity NFC-free is deliberate:
 *
 *  - The Capacitor bridge stores any launch-intent data URI as the "launch
 *    URL", which would hand the same tag to the deep-link path a second time.
 *  - noHistory + excludeFromRecents guarantee this activity is never replayed
 *    from the recents screen, so a stale tag can never re-trigger a payment
 *    flow after process death.
 *  - Android 17 (API 37) requires activities receiving NFC intents to be
 *    protected with android.permission.DISPATCH_NFC_MESSAGE once targetSdk
 *    moves past 36. That attribute is activity-wide and can therefore never
 *    go on the launcher / deep-link activity. When targetSdk is raised, add
 *    it to THIS activity's manifest entry (never earlier — the permission
 *    does not exist on older platforms and would break dispatch there).
 *
 * Flow: validate the intent → parse the NDEF payload → NfcScanBuffer.store()
 * → start MainActivity → finish. JavaScript pulls the scan at most once via
 * NfcPlugin.consumePendingScan() (at boot on cold start, on app resume when
 * the app was merely backgrounded). The stored dispatch also arms a short
 * one-shot guard against the same tap being rediscovered by reader mode.
 * While BuhoGO is foregrounded this activity never runs: reader mode in
 * MainActivity owns the NFC field and system dispatch is suspended.
 */
public class NfcDispatchActivity extends Activity {

    private static final String NFC_LOG_TAG = "BuhoNfc";

    /** Source label attached to scans captured here (mirrored to JS). */
    private static final String SCAN_SOURCE = "system_dispatch";

    /**
     * Native mirror of the manifest's NDEF scheme filter. The manifest is the
     * real gate for system NFC dispatch; this list only hardens the exported
     * activity against non-NFC senders handing it arbitrary content, and is
     * the single place (besides the manifest) to touch when the supported
     * scheme set changes.
     *
     * ACTIVE:  payment + auth schemes BuhoGO fully supports today.
     * FUTURE:  extend here AND in AndroidManifest.xml together —
     *          "lnurlc:" once a channel-request flow is implemented,
     *          custom/proprietary tag schemes as product needs appear.
     * NEVER:   catch-alls that would claim foreign tags (contactless bank
     *          cards, transit cards, access badges) — see the manifest's
     *          NEVER section for the full reasoning.
     */
    private static final String[] SCHEME_ALLOWLIST = {
        "lightning:",
        "lnurl:",
        "lnurlp:",
        "lnurlw:",
        "bitcoin:",
        "keyauth:",
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            captureScan(getIntent());
        } catch (Exception e) {
            // Guarded: a malformed tag must never crash the entry activity.
            Log.e(NFC_LOG_TAG, "Failed to capture NFC dispatch payload", e);
        }

        // Bring the app up regardless of capture success — worst case the
        // user lands on the wallet with no scan, exactly as if they had
        // tapped the app icon. MainActivity is singleTask, so an existing
        // instance is brought forward and a fresh one is created otherwise.
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }

    /**
     * Extracts the tag payload from an ACTION_NDEF_DISCOVERED intent and
     * buffers it for the JS layer. Parsing EXTRA_NDEF_MESSAGES is pure
     * in-memory work, so it is safe on the UI thread.
     */
    private void captureScan(Intent intent) {
        if (intent == null || !NfcAdapter.ACTION_NDEF_DISCOVERED.equals(intent.getAction())) {
            return;
        }

        Parcelable[] rawMessages = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
        if (rawMessages == null || rawMessages.length == 0 || !(rawMessages[0] instanceof NdefMessage)) {
            // ACTION_NDEF_DISCOVERED always carries the message the system
            // already parsed to match our scheme filter; a missing extra can
            // only mean a TECH/TAG-based dispatch, which BuhoGO deliberately
            // does not register.
            // FUTURE: if a TECH_DISCOVERED fallback is ever added for OEM
            // stacks that fail to expose NTAG 424 DNA as NDEF, read the tag
            // here via NfcPayloadReader.readFromTag(EXTRA_TAG) on a worker
            // thread before starting MainActivity.
            Log.w(NFC_LOG_TAG, "NDEF dispatch without NDEF message — ignoring");
            return;
        }

        String raw = NfcPayloadReader.parseNdefMessage((NdefMessage) rawMessages[0]);
        if (raw == null || raw.isEmpty() || !isAllowedScheme(raw)) {
            // Log the scheme only — raw payloads carry one-time card
            // authentication parameters and must never reach logcat.
            Log.w(NFC_LOG_TAG, "Dispatched tag payload not in scheme allowlist — ignoring");
            return;
        }

        NfcScanBuffer.store(raw, SCAN_SOURCE);
    }

    private static boolean isAllowedScheme(String raw) {
        String lower = raw.trim().toLowerCase(Locale.ROOT);
        for (String scheme : SCHEME_ALLOWLIST) {
            if (lower.startsWith(scheme)) return true;
        }
        return false;
    }
}
