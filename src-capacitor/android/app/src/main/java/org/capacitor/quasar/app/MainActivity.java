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

        try {
            IntentFilter ndef = new IntentFilter(NfcAdapter.ACTION_NDEF_DISCOVERED);
            ndef.addDataType("*/*");
            nfcIntentFilters = new IntentFilter[]{ ndef };
        } catch (IntentFilter.MalformedMimeTypeException e) {
            nfcIntentFilters = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            nfcAdapter.enableForegroundDispatch(this, nfcPendingIntent, nfcIntentFilters, null);
        }
        dispatchNfcIntent(getIntent());
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (nfcAdapter != null) {
            nfcAdapter.disableForegroundDispatch(this);
        }
    }

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
        }
    }
}
