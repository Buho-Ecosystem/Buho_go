package org.capacitor.quasar.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NfcPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Called when the app is already running and a new NFC intent is dispatched.
     * (foreground NFC dispatch)
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchNfcIntent(intent);
    }

    /**
     * Called on app start — handles the case where the app was launched via NFC tag scan.
     */
    @Override
    public void onResume() {
        super.onResume();
        dispatchNfcIntent(getIntent());
    }

    private void dispatchNfcIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (android.nfc.NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
                || android.nfc.NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
                || android.nfc.NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)) {
            NfcPlugin plugin = (NfcPlugin) getBridge().getPlugin("Nfc").getInstance();
            if (plugin != null) {
                plugin.handleNfcIntent(intent);
            }
        }
    }
}
