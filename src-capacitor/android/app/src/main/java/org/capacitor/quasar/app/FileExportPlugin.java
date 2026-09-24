package org.capacitor.quasar.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;

/**
 * FileExportPlugin — "Save" for files the app produces (transaction reports).
 *
 * Opens the Storage Access Framework's create-document dialog, so the user
 * chooses the folder and the name, then writes the bytes to the document
 * they created. This is the platform's supported way for an app to put a file
 * in shared storage:
 *
 *   - No storage permission on any Android version. The user's choice in the
 *     dialog is the grant, and it covers exactly the one document.
 *   - Served by the system DocumentsUI, which is part of AOSP rather than
 *     Google Play services, so it works unchanged on GrapheneOS and other
 *     devices without Google services. Any installed document provider
 *     (Nextcloud, a USB drive, a cloud app) appears in the same dialog.
 *
 * The share sheet stays a separate action in JS; it cannot stand in for this,
 * because on a phone without a storage app it offers nowhere to keep a file.
 *
 * JS contract: save({ filename, mimeType, data }) with `data` in base64,
 * resolving { saved: true } once written, or { saved: false } when the user
 * closes the dialog. A failure to write rejects and leaves no empty file.
 */
@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {

    private static final String TAG = "BuhoFileExport";

    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename");
        String data = call.getString("data");
        if (TextUtils.isEmpty(filename) || data == null) {
            call.reject("filename and data are required", "INVALID_ARGUMENT");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(call.getString("mimeType", "application/octet-stream"))
            .putExtra(Intent.EXTRA_TITLE, filename);

        try {
            // The call, with its data, is kept by the bridge until the result.
            startActivityForResult(call, intent, "onDocumentCreated");
        } catch (ActivityNotFoundException e) {
            // Only on a build that strips DocumentsUI; nothing to fall back to here.
            fail(call, "No app on this device can save files", "UNAVAILABLE", e);
        }
    }

    @ActivityCallback
    private void onDocumentCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent intent = result.getData();
        Uri uri = intent != null ? intent.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            settle(call, false);
            return;
        }

        // Callbacks arrive on the main thread, and the chosen provider may be
        // slow (a network drive), so the write happens on the bridge's
        // background thread.
        getBridge().execute(() -> writeDocument(call, uri));
    }

    private void writeDocument(PluginCall call, Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        try {
            byte[] bytes = Base64.decode(call.getString("data"), Base64.DEFAULT);
            try (OutputStream out = resolver.openOutputStream(uri, "w")) {
                if (out == null) throw new IOException("The chosen location cannot be written to");
                out.write(bytes);
            }
            settle(call, true);
        } catch (IOException | IllegalArgumentException | SecurityException e) {
            // The dialog already created the document; remove it rather than
            // leave an empty file with the report's name.
            deleteQuietly(resolver, uri);
            fail(call, "The file couldn't be saved", "WRITE_FAILED", e);
        }
    }

    private static void deleteQuietly(ContentResolver resolver, Uri uri) {
        try {
            DocumentsContract.deleteDocument(resolver, uri);
        } catch (Exception e) {
            Log.w(TAG, "Could not remove the incomplete document", e);
        }
    }

    /*
     * The bridge holds a call passed to startActivityForResult, and with it
     * the file's bytes, until it is released. Every way out releases it.
     */

    private void settle(PluginCall call, boolean saved) {
        JSObject ret = new JSObject();
        ret.put("saved", saved);
        call.resolve(ret);
        getBridge().releaseCall(call);
    }

    private void fail(PluginCall call, String message, String code, Exception e) {
        call.reject(message, code, e);
        getBridge().releaseCall(call);
    }
}
