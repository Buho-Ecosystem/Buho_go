package org.capacitor.quasar.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentFilter;
import android.nfc.NfcAdapter;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private IntentFilter[] nfcIntentFilters;

    /**
     * Register Capacitor plugins and prepare foreground NFC dispatch.
     * Foreground dispatch lets this activity claim exclusive tag
     * priority over any other installed wallet while it is in the
     * foreground, bypassing the Android app chooser entirely.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NfcPlugin.class);
        super.onCreate(savedInstanceState);

        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        if (nfcAdapter == null) return;

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? PendingIntent.FLAG_MUTABLE : 0;

        nfcPendingIntent = PendingIntent.getActivity(
            this, 0,
            new Intent(this, getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            flags
        );

        // Mirror the manifest's NFC intent-filters so foreground dispatch
        // catches every action dispatchNfcIntent() knows how to route.
        // Without TAG_DISCOVERED and TECH_DISCOVERED the system would fall
        // back to the manifest for non-NDEF tags and the chooser could
        // reappear.
        try {
            IntentFilter ndef = new IntentFilter(NfcAdapter.ACTION_NDEF_DISCOVERED);
            ndef.addDataType("*/*");
            IntentFilter tag = new IntentFilter(NfcAdapter.ACTION_TAG_DISCOVERED);
            IntentFilter tech = new IntentFilter(NfcAdapter.ACTION_TECH_DISCOVERED);
            nfcIntentFilters = new IntentFilter[]{ ndef, tag, tech };
        } catch (IntentFilter.MalformedMimeTypeException e) {
            // "*/*" is well-formed so this branch is unreachable in
            // practice. If it ever fired we'd rather disable foreground
            // dispatch entirely than register a null filter array, which
            // would silently widen registration to every NDEF tag the
            // device sees.
            nfcAdapter = null;
        }
    }

    /**
     * Re-enable foreground dispatch and process any tag intent the
     * activity was launched with (cold start via tag scan).
     */
    @Override
    protected void onResume() {
        super.onResume();
        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            nfcAdapter.enableForegroundDispatch(this, nfcPendingIntent, nfcIntentFilters, null);
        }
        dispatchNfcIntent(getIntent());
    }

    /**
     * Release foreground dispatch so the rest of the system regains
     * its normal NFC routing while the activity is not visible.
     */
    @Override
    protected void onPause() {
        super.onPause();
        if (nfcAdapter != null) {
            nfcAdapter.disableForegroundDispatch(this);
        }
    }

    /**
     * Receive tag intents delivered while the activity is already
     * running. setIntent() caches the intent so onResume sees the
     * same value on the next lifecycle pass.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchNfcIntent(intent);
    }

    private void dispatchNfcIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)) {
            NfcPlugin plugin = (NfcPlugin) getBridge().getPlugin("Nfc").getInstance();
            if (plugin != null) {
                plugin.handleNfcIntent(intent);
            }
            // Consume the intent so a subsequent onResume cycle cannot
            // re-dispatch the same tag (e.g. user backgrounds and
            // returns after a Boltcard scan would otherwise replay it).
            setIntent(new Intent());
        }
    }
}
