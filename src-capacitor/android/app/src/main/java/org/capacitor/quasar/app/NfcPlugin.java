package org.capacitor.quasar.app;

import android.nfc.NfcAdapter;
import android.nfc.Tag;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NfcPlugin — Capacitor bridge between BuhoGO's two native NFC paths and the
 * JavaScript layer.
 *
 * Foreground path (push): MainActivity's reader mode delivers tags to
 * handleTag(), which reads them via NfcPayloadReader and emits an event.
 *
 * Cold/backgrounded path (pull): NfcDispatchActivity buffers the scan in
 * NfcScanBuffer; JavaScript drains it through consumePendingScan() once it
 * is ready (at boot and on every app resume). Pull instead of push because a
 * scan captured before the WebView exists would race the JS boot and be lost.
 *
 * Events emitted to JS (foreground path):
 *  - "nfcTag"  { raw: string }     — parsed text/URI from tag
 *  - "nfcError"{ message: string } — tag found but unreadable
 */
@CapacitorPlugin(name = "Nfc")
public class NfcPlugin extends Plugin {

    /**
     * Called by MainActivity's reader-mode callback (onTagDiscovered) when a
     * tag enters the field while the app is in the foreground. Reads the NDEF
     * payload — via the standard Ndef tech, or the raw T4T/IsoDep path for
     * NTAG 424 DNA Bolt Cards — and emits the result to JavaScript listeners.
     *
     * Runs on the NFC reader binder thread, never the UI thread, which is
     * where the blocking tag IO belongs.
     */
    public void handleTag(Tag tag) {
        if (tag == null) return;

        String raw = NfcPayloadReader.readFromTag(tag);
        if (raw != null && !raw.isEmpty()) {
            JSObject result = new JSObject();
            result.put("raw", raw);
            notifyListeners("nfcTag", result);
        } else {
            JSObject err = new JSObject();
            err.put("message", "NFC tag found but contains no NDEF data");
            notifyListeners("nfcError", err);
        }
    }

    /**
     * One-shot pull of a scan captured by NfcDispatchActivity while the
     * WebView was not ready (cold start) or the app was backgrounded.
     *
     * Resolves with { found: true, raw, source, id } at most once per scan:
     * consuming clears the native buffer. Resolves with { found: false } when
     * nothing is pending. Never rejects, so JS can await unconditionally.
     */
    @PluginMethod
    public void consumePendingScan(PluginCall call) {
        NfcScanBuffer.Scan scan = NfcScanBuffer.consume();
        JSObject result = new JSObject();
        if (scan == null) {
            result.put("found", false);
        } else {
            result.put("found", true);
            result.put("raw", scan.raw);
            result.put("source", scan.source);
            result.put("id", scan.id);
        }
        call.resolve(result);
    }

    /**
     * Check NFC availability on this device.
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        JSObject result = new JSObject();
        if (adapter == null) {
            result.put("available", false);
            result.put("enabled", false);
        } else {
            result.put("available", true);
            result.put("enabled", adapter.isEnabled());
        }
        call.resolve(result);
    }

    /**
     * Open Android NFC settings so the user can enable it.
     */
    @PluginMethod
    public void showSettings(PluginCall call) {
        android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_NFC_SETTINGS);
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
