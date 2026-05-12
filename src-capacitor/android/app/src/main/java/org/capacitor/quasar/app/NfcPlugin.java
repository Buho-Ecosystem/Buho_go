package org.capacitor.quasar.app;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Parcelable;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * NfcPlugin — Custom Capacitor plugin for NFC tag reading.
 *
 * Supports:
 *  - NDEF URI records  (lnurlw://, lnurlp://, lightning:, https:// for LNURL)
 *  - NDEF Text records (plain LNURL1..., Lightning addresses)
 *
 * Events emitted to JS:
 *  - "nfcTag"  { raw: string }  — parsed text/URI from tag
 *  - "nfcError"{ message: string } — if parsing fails
 */
@CapacitorPlugin(name = "Nfc")
public class NfcPlugin extends Plugin {

    /**
     * Called by MainActivity when an NFC intent arrives (onNewIntent / onResume).
     * Parses NDEF records and emits the result to JavaScript listeners.
     */
    public void handleNfcIntent(android.content.Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();

        if (NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
                || NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
                || NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)) {

            Parcelable[] rawMessages = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);

            if (rawMessages == null || rawMessages.length == 0) {
                JSObject err = new JSObject();
                err.put("message", "NFC tag found but contains no NDEF data");
                notifyListeners("nfcError", err);
                return;
            }

            // Process first NDEF message, first record
            NdefMessage ndefMessage = (NdefMessage) rawMessages[0];
            NdefRecord[] records = ndefMessage.getRecords();

            if (records == null || records.length == 0) {
                return;
            }

            String parsed = parseNdefRecord(records[0]);
            if (parsed != null && !parsed.isEmpty()) {
                JSObject result = new JSObject();
                result.put("raw", parsed);
                notifyListeners("nfcTag", result);
            }
        }
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

    // ─── NDEF Parsing ────────────────────────────────────────────────────────

    private String parseNdefRecord(NdefRecord record) {
        short tnf = record.getTnf();
        byte[] type = record.getType();
        byte[] payload = record.getPayload();

        // URI record (TNF = 0x01 or 0x03 absolute URI)
        if (tnf == NdefRecord.TNF_WELL_KNOWN
                && Arrays.equals(type, NdefRecord.RTD_URI)) {
            return parseUriRecord(payload);
        }

        // Text record (TNF = 0x01, type = "T")
        if (tnf == NdefRecord.TNF_WELL_KNOWN
                && Arrays.equals(type, NdefRecord.RTD_TEXT)) {
            return parseTextRecord(payload);
        }

        // Absolute URI (TNF = 0x03)
        if (tnf == NdefRecord.TNF_ABSOLUTE_URI) {
            return new String(type, StandardCharsets.UTF_8);
        }

        // MIME (TNF = 0x02) — try raw payload as UTF-8
        if (tnf == NdefRecord.TNF_MIME_MEDIA) {
            return new String(payload, StandardCharsets.UTF_8).trim();
        }

        return null;
    }

    /**
     * Decode an NDEF URI record.
     * The first byte is the URI identifier code (0x00 = no prefix, 0x01 = http://www., etc.)
     */
    private String parseUriRecord(byte[] payload) {
        if (payload == null || payload.length == 0) return null;
        byte prefixCode = payload[0];
        String suffix = new String(payload, 1, payload.length - 1, StandardCharsets.UTF_8);
        return URI_PREFIXES[prefixCode & 0xFF] + suffix;
    }

    /**
     * Decode an NDEF Text record.
     * Byte 0: status byte — bit 7 = encoding (0=UTF-8, 1=UTF-16), bits 5-0 = language code length
     */
    private String parseTextRecord(byte[] payload) {
        if (payload == null || payload.length == 0) return null;
        int statusByte = payload[0] & 0xFF;
        boolean isUtf16 = (statusByte & 0x80) != 0;
        int languageCodeLen = statusByte & 0x3F;
        int textStart = 1 + languageCodeLen;
        if (textStart >= payload.length) return null;
        Charset charset = isUtf16 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8;
        return new String(payload, textStart, payload.length - textStart, charset).trim();
    }

    // NDEF URI prefix codes per NFC Forum URI Record Type Definition spec
    private static final String[] URI_PREFIXES = {
        "",                   // 0x00 — no prepend
        "http://www.",        // 0x01
        "https://www.",       // 0x02
        "http://",            // 0x03
        "https://",           // 0x04
        "tel:",               // 0x05
        "mailto:",            // 0x06
        "ftp://anonymous:anonymous@", // 0x07
        "ftp://ftp.",         // 0x08
        "ftps://",            // 0x09
        "sftp://",            // 0x0A
        "smb://",             // 0x0B
        "nfs://",             // 0x0C
        "ftp://",             // 0x0D
        "dav://",             // 0x0E
        "news:",              // 0x0F
        "telnet://",          // 0x10
        "imap:",              // 0x11
        "rtsp://",            // 0x12
        "urn:",               // 0x13
        "pop:",               // 0x14
        "sip:",               // 0x15
        "sips:",              // 0x16
        "tftp:",              // 0x17
        "btspp://",           // 0x18
        "btl2cap://",         // 0x19
        "btgoep://",          // 0x1A
        "tcpobex://",         // 0x1B
        "irdaobex://",        // 0x1C
        "file://",            // 0x1D
        "urn:epc:id:",        // 0x1E
        "urn:epc:tag:",       // 0x1F
        "urn:epc:pat:",       // 0x20
        "urn:epc:raw:",       // 0x21
        "urn:epc:",           // 0x22
        "urn:nfc:",           // 0x23
    };
}
