package org.capacitor.quasar.app;

import android.content.Intent;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * MainActivity — hosts the Capacitor WebView and BuhoGO's native plugins.
 *
 * NFC design (two complementary paths):
 *
 *   Foreground — reader mode, owned by this activity. While visible,
 *   enableReaderMode turns the device into a pure reader: tags are delivered
 *   straight to onTagDiscovered with priority over every other installed
 *   wallet and without the system chooser. The platform NDEF check stays
 *   enabled — it is what surfaces the Ndef technology on standard tags
 *   (NTAG 21x stickers); NfcPayloadReader falls back to a raw IsoDep read
 *   for NTAG 424 DNA Bolt Cards where that check is unreliable. The system
 *   tap sound is kept on purpose: it is the familiar "tag registered"
 *   feedback and the app plays no sound of its own.
 *
 *   Closed / backgrounded — system NDEF dispatch, owned exclusively by
 *   NfcDispatchActivity (see its javadoc). MainActivity itself declares no
 *   NFC intent filters and never receives NFC intents: it stays the plain
 *   launcher / deep-link activity, which keeps Capacitor's launch-URL
 *   handling and the future Android 17 NFC dispatch permission out of each
 *   other's way. Scans captured there reach JavaScript through the pull
 *   handshake in NfcPlugin.consumePendingScan().
 */
public class MainActivity extends BridgeActivity implements NfcAdapter.ReaderCallback {

    private static final String NFC_LOG_TAG = "BuhoNfc";

    // NFC-A/B/F/V covers every NDEF-capable tag family in the wild
    // (NTAG 21x, NTAG 424 DNA Bolt Cards, FeliCa, ICODE). Do NOT add
    // FLAG_READER_SKIP_NDEF_CHECK: skipping the check would strip the Ndef
    // technology from discovered tags, and Type 2 stickers (NTAG 21x) have
    // no IsoDep fallback — they would become unreadable.
    private static final int READER_FLAGS =
              NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V;

    private NfcAdapter nfcAdapter;

    /**
     * Register plugins and apply the screen-privacy flag before the first
     * frame. FLAG_SECURE is read straight from SharedPreferences (owned by
     * SecureScreenPlugin) so it is set before super.onCreate() renders —
     * fail-secure on first launch (default ON until the user opts out).
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NfcPlugin.class);
        registerPlugin(SecureScreenPlugin.class);
        registerPlugin(BuhoUpdatePlugin.class);

        if (SecureScreenPlugin.readPersistedPreference(this)) {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        }

        super.onCreate(savedInstanceState);

        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
    }

    /**
     * Enable reader mode while visible, and re-apply FLAG_SECURE. Some Android
     * lifecycle paths (multi-window, configuration changes, certain OEM skins)
     * can clear window flags on resume, so we re-state the intent every time.
     */
    @Override
    public void onResume() {
        super.onResume();

        SecureScreenPlugin.applyFlagToWindow(
            this,
            SecureScreenPlugin.readPersistedPreference(this)
        );

        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            nfcAdapter.enableReaderMode(this, this, READER_FLAGS, null);
        }
    }

    /**
     * Release reader mode when the activity leaves the foreground so the rest
     * of the system regains its normal NFC routing.
     */
    @Override
    public void onPause() {
        super.onPause();
        if (nfcAdapter != null) {
            nfcAdapter.disableReaderMode(this);
        }
    }

    /**
     * Keep getIntent() in sync for deep links delivered while running. NFC
     * never arrives here as an intent (foreground taps come through reader
     * mode, system dispatch goes to NfcDispatchActivity), so this only serves
     * Capacitor's appUrlOpen handling; super.onNewIntent() lets the bridge
     * process lightning: / bitcoin: links.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    /**
     * Reader-mode callback. Runs on a dedicated NFC binder thread (never the
     * UI thread), which is exactly where the blocking tag IO belongs. Guarded:
     * an uncaught exception on a binder thread would crash the whole app.
     */
    @Override
    public void onTagDiscovered(Tag tag) {
        try {
            if (NfcScanBuffer.consumeReaderHandoffGuard()) {
                Log.i(NFC_LOG_TAG, "Suppressed duplicate reader callback during NFC dispatch handoff");
                return;
            }

            NfcPlugin plugin = resolveNfcPlugin();
            if (plugin != null) {
                plugin.handleTag(tag);
            }
        } catch (Exception e) {
            Log.e(NFC_LOG_TAG, "Unhandled error while reading NFC tag", e);
        }
    }

    private NfcPlugin resolveNfcPlugin() {
        if (getBridge() == null) return null;
        PluginHandle handle = getBridge().getPlugin("Nfc");
        if (handle == null) return null;
        return (NfcPlugin) handle.getInstance();
    }
}
