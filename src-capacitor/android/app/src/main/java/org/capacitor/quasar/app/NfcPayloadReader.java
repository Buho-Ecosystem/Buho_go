package org.capacitor.quasar.app;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.Tag;
import android.nfc.tech.IsoDep;
import android.nfc.tech.Ndef;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * NfcPayloadReader — the single place that turns NFC input (an NDEF message
 * or a physical Tag) into the raw payment/auth string BuhoGO understands.
 *
 * Shared by both NFC entry paths so they can never drift apart:
 *   - foreground reader mode    MainActivity → NfcPlugin.handleTag
 *   - system NDEF dispatch      NfcDispatchActivity (cold/backgrounded start)
 *
 * FUTURE: support for additional tag content (custom NDEF external types,
 * proprietary tag formats) belongs HERE, so both entry paths pick it up
 * automatically.
 */
final class NfcPayloadReader {

    private NfcPayloadReader() {}

    // ─── NDEF Parsing ────────────────────────────────────────────────────────

    /**
     * Extracts the payload string from a fully parsed NDEF message (as
     * delivered in ACTION_NDEF_DISCOVERED's EXTRA_NDEF_MESSAGES).
     * Returns null when the first record is not a type BuhoGO understands.
     */
    static String parseNdefMessage(NdefMessage message) {
        if (message == null) return null;
        NdefRecord[] records = message.getRecords();
        if (records == null || records.length == 0) return null;
        return parseNdefRecord(records[0]);
    }

    static String parseNdefRecord(NdefRecord record) {
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
    private static String parseUriRecord(byte[] payload) {
        if (payload == null || payload.length == 0) return null;
        byte prefixCode = payload[0];
        String suffix = new String(payload, 1, payload.length - 1, StandardCharsets.UTF_8);
        return URI_PREFIXES[prefixCode & 0xFF] + suffix;
    }

    /**
     * Decode an NDEF Text record.
     * Byte 0: status byte — bit 7 = encoding (0=UTF-8, 1=UTF-16), bits 5-0 = language code length
     */
    private static String parseTextRecord(byte[] payload) {
        if (payload == null || payload.length == 0) return null;
        int statusByte = payload[0] & 0xFF;
        boolean isUtf16 = (statusByte & 0x80) != 0;
        int languageCodeLen = statusByte & 0x3F;
        int textStart = 1 + languageCodeLen;
        if (textStart >= payload.length) return null;
        Charset charset = isUtf16 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8;
        return new String(payload, textStart, payload.length - textStart, charset).trim();
    }

    // ─── Tag reading (standard NDEF + NTAG 424 DNA Bolt Cards) ───────────────

    /**
     * Reads the NDEF payload from a Tag delivered by reader mode.
     *
     * Blocking tag IO — must never run on the UI thread.
     *
     * Tries two approaches in order:
     *  1. Android Ndef technology class  — present on standard NDEF tags
     *     (NTAG 21x stickers etc.) because the platform NDEF check runs
     *     during reader-mode discovery.
     *  2. Raw IsoDep APDU sequence       — T4T NDEF read per ISO 7816-4 / NFC
     *     Forum T4T spec; required when Ndef.get() returns null (some Android
     *     versions / OEM NFC stacks fail to surface NTAG 424 DNA as Ndef).
     */
    static String readFromTag(Tag tag) {
        if (tag == null) return null;

        // Approach 1: standard Ndef technology
        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            try {
                ndef.connect();
                NdefMessage message = ndef.getNdefMessage();
                String raw = parseNdefMessage(message);
                if (raw != null) return raw;
            } catch (Exception ignored) {
                // fall through to IsoDep
            } finally {
                try { ndef.close(); } catch (Exception ignored) {}
            }
        }

        // Approach 2: raw T4T NDEF over IsoDep (NTAG 424 DNA / Bolt Card path)
        return readViaIsoDep(tag);
    }

    /**
     * Reads the NDEF file from a T4T tag using raw ISO 7816-4 APDU commands.
     *
     * Sequence:
     *   SELECT NDEF Application → SELECT CC File → READ CC →
     *   SELECT NDEF File (ID from CC) → READ NDEF length → READ NDEF data
     */
    private static String readViaIsoDep(Tag tag) {
        IsoDep isoDep = IsoDep.get(tag);
        if (isoDep == null) return null;

        try {
            isoDep.connect();
            isoDep.setTimeout(3000);

            // SELECT NDEF Application (D2 76 00 00 85 01 01)
            byte[] r = isoDep.transceive(new byte[]{
                0x00, (byte)0xA4, 0x04, 0x00, 0x07,
                (byte)0xD2, 0x76, 0x00, 0x00, (byte)0x85, 0x01, 0x01, 0x00
            });
            if (!swOk(r)) return null;

            // SELECT Capability Container (E1 03)
            r = isoDep.transceive(new byte[]{
                0x00, (byte)0xA4, 0x00, 0x0C, 0x02, (byte)0xE1, 0x03
            });
            if (!swOk(r)) return null;

            // READ BINARY — first 15 bytes of CC
            r = isoDep.transceive(new byte[]{0x00, (byte)0xB0, 0x00, 0x00, 0x0F});
            if (!swOk(r) || r.length < 17) return null;

            // CC[9..10] = NDEF file ID (typically E1 04)
            byte fileId0 = r[9];
            byte fileId1 = r[10];

            // SELECT NDEF File
            r = isoDep.transceive(new byte[]{
                0x00, (byte)0xA4, 0x00, 0x0C, 0x02, fileId0, fileId1
            });
            if (!swOk(r)) return null;

            // READ BINARY — 2-byte NDEF length field at offset 0
            r = isoDep.transceive(new byte[]{0x00, (byte)0xB0, 0x00, 0x00, 0x02});
            if (!swOk(r) || r.length < 4) return null;
            int ndefLen = ((r[0] & 0xFF) << 8) | (r[1] & 0xFF);
            if (ndefLen <= 0 || ndefLen > 2000) return null;

            // READ NDEF data in chunks of up to 250 bytes (offset starts at 2)
            byte[] ndefBytes = new byte[ndefLen];
            int pos = 0;
            while (pos < ndefLen) {
                int chunk = Math.min(ndefLen - pos, 250);
                int fileOff = pos + 2;
                r = isoDep.transceive(new byte[]{
                    0x00, (byte)0xB0,
                    (byte)((fileOff >> 8) & 0xFF),
                    (byte)(fileOff & 0xFF),
                    (byte)chunk
                });
                if (!swOk(r) || r.length < chunk + 2) return null;
                System.arraycopy(r, 0, ndefBytes, pos, chunk);
                pos += chunk;
            }

            // Parse using Android's NdefMessage (handles all TNF/type variants)
            return parseNdefMessage(new NdefMessage(ndefBytes));

        } catch (Exception ignored) {
            return null;
        } finally {
            try { isoDep.close(); } catch (Exception ignored) {}
        }
    }

    private static boolean swOk(byte[] r) {
        return r != null && r.length >= 2
            && r[r.length - 2] == (byte)0x90
            && r[r.length - 1] == (byte)0x00;
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
