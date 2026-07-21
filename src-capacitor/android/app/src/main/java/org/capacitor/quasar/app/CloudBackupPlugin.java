package org.capacitor.quasar.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.text.TextUtils;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.auth.api.signin.GoogleSignInStatusCodes;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

/**
 * Google Drive `appDataFolder` implementation of the cloud-backup contract.
 * Files uploaded here are visible only to this app + the signed-in user —
 * they never appear in the user's normal Drive UI, which keeps the encrypted
 * recovery file out of casual view.
 *
 * Encryption happens in JS BEFORE upload (utils/backupCrypto.js); this
 * plugin only ever moves opaque bytes and never sees a seed phrase or the
 * passphrase.
 *
 * Auth model: no OAuth client ID or secret ships in the app. Google
 * identifies the app by its package name (mybuho.buhogo) plus the APK
 * signing SHA-1, both registered server-side in Google Cloud Console.
 * Play Services mints short-lived access tokens on demand via
 * GoogleAuthUtil.getToken, so there is no stored token to refresh or leak.
 *
 * Required one-time setup (see docs/CLOUD_BACKUP_SETUP.md):
 *   1. Google Cloud Console: OAuth 2.0 client of type "Android"
 *      - Package name: mybuho.buhogo
 *      - SHA-1: release keystore fingerprint (and debug keystore for dev)
 *   2. Enable the Google Drive API for the same project
 *   3. Consent screen with the drive.appdata scope
 *   No client_secret exists for the Android client type.
 */
@CapacitorPlugin(name = "CloudBackup")
public class CloudBackupPlugin extends Plugin {

    private static final String TAG = "BuhoCloudBackup";
    private static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    private static final String DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
    private static final String DRIVE_UPLOAD_URL =
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    private static final String APP_DATA_PARENT = "appDataFolder";
    private static final String PREFS_NAME = "CloudBackup";
    private static final String PREF_KEY = "buho_cloud_backup_account";

    private GoogleSignInClient signInClient() {
        GoogleSignInOptions opts = new GoogleSignInOptions
            .Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestScopes(new Scope(DRIVE_SCOPE))
            .build();
        return GoogleSignIn.getClient(getContext(), opts);
    }

    private GoogleSignInAccount currentAccount() {
        GoogleSignInAccount acc = GoogleSignIn.getLastSignedInAccount(getContext());
        if (acc == null) return null;
        if (!GoogleSignIn.hasPermissions(acc, new Scope(DRIVE_SCOPE))) return null;
        return acc;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        // Drive is effectively always available on Android with Play
        // Services. Sign-in state is a separate question — probed by the JS
        // layer through listBackups, which rejects with "auth-required".
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void signIn(final PluginCall call) {
        // If a previous sign-in cached the account WITHOUT the Drive scope,
        // Google silently re-picks that account on the next attempt and
        // never re-prompts for the missing scope — the dialog "loops".
        // Sign out first to force a fresh consent screen in that case.
        GoogleSignInAccount existing = GoogleSignIn.getLastSignedInAccount(getContext());
        boolean staleAccount = existing != null
            && !GoogleSignIn.hasPermissions(existing, new Scope(DRIVE_SCOPE));
        if (staleAccount) {
            Log.i(TAG, "signIn: cached account missing Drive scope — forcing sign-out first");
            signInClient().signOut().addOnCompleteListener(t -> launchSignInIntent(call));
        } else {
            launchSignInIntent(call);
        }
    }

    private void launchSignInIntent(PluginCall call) {
        Intent intent = signInClient().getSignInIntent();
        startActivityForResult(call, intent, "onSignInResult");
    }

    @ActivityCallback
    private void onSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        // Do NOT trust `resultCode` alone. Play Services returns
        // RESULT_CANCELED on internal failures too (e.g. DEVELOPER_ERROR
        // when the APK's SHA-1 isn't registered in Cloud Console). The real
        // cause is embedded as an ApiException in the result intent — if we
        // early-returned on RESULT_CANCELED, a misconfigured OAuth client
        // would look identical to the user tapping cancel.
        Intent data = result.getData();
        if (data == null) {
            // No intent at all → the user truly aborted before anything ran.
            Log.w(TAG, "onSignInResult: no result intent (resultCode=" + result.getResultCode() + ")");
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "cancelled");
            call.resolve(ret);
            return;
        }

        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        final GoogleSignInAccount acc;
        try {
            acc = task.getResult(ApiException.class);
        } catch (ApiException e) {
            int code = e.getStatusCode();
            String codeName = GoogleSignInStatusCodes.getStatusCodeString(code);
            String detail = e.getMessage() == null ? "" : (" — " + e.getMessage());
            Log.e(TAG, "onSignInResult: ApiException(" + code + ") " + codeName + detail, e);

            JSObject ret = new JSObject();
            ret.put("ok", false);
            // Map known codes to actionable reasons so the JS layer can show
            // a meaningful message instead of a generic "cancelled".
            switch (code) {
                case GoogleSignInStatusCodes.SIGN_IN_CANCELLED:
                    ret.put("reason", "user-cancelled");
                    break;
                case GoogleSignInStatusCodes.SIGN_IN_FAILED:
                    // 12500: usually OAuth Android client misconfig in Cloud Console
                    ret.put("reason", "sign-in-failed-12500: " + codeName + detail);
                    break;
                case GoogleSignInStatusCodes.SIGN_IN_CURRENTLY_IN_PROGRESS:
                    ret.put("reason", "sign-in-in-progress");
                    break;
                case GoogleSignInStatusCodes.NETWORK_ERROR:
                    ret.put("reason", "network-error: " + detail);
                    break;
                case 10: // DEVELOPER_ERROR — SHA-1 in Cloud Console doesn't match this APK
                    ret.put("reason", "developer-error-10-sha1-mismatch: " + detail);
                    break;
                default:
                    ret.put("reason", "ApiException-" + code + " " + codeName + detail);
            }
            call.resolve(ret);
            return;
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "sign-in-failed" : e.getMessage();
            Log.e(TAG, "onSignInResult: unexpected exception: " + msg, e);
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", msg);
            call.resolve(ret);
            return;
        }
        if (acc == null) {
            Log.w(TAG, "onSignInResult: account is null after sign-in");
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no-account");
            call.resolve(ret);
            return;
        }
        if (!GoogleSignIn.hasPermissions(acc, new Scope(DRIVE_SCOPE))) {
            // Signed in but the Drive scope was not granted. Sign out so the
            // next attempt re-prompts for consent, then bubble an actionable
            // reason to the JS layer.
            Log.w(TAG, "onSignInResult: Drive scope not granted — signing out for clean retry");
            signInClient().signOut();
            getContext().getSharedPreferences(PREFS_NAME, 0).edit().remove(PREF_KEY).apply();
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "drive-scope-not-granted");
            call.resolve(ret);
            return;
        }
        // Persist the email up-front so currentAccountEmail() can fall back
        // on it if Play Services hasn't refreshed its cached account yet.
        SharedPreferences sp = getContext().getSharedPreferences(PREFS_NAME, 0);
        sp.edit().putString(PREF_KEY, acc.getEmail()).apply();
        Log.i(TAG, "onSignInResult: signed in — probing token");

        // Probe getToken on a worker thread to verify the Drive scope is
        // actually usable. Without this, listBackups would fail downstream
        // and the JS state machine would loop straight back to "Sign in".
        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                GoogleAuthUtil.getToken(getContext(), acc.getEmail(), "oauth2:" + DRIVE_SCOPE);
                Log.i(TAG, "onSignInResult: token probe OK");
                ret.put("ok", true);
                ret.put("account", acc.getEmail());
                call.resolve(ret);
            } catch (UserRecoverableAuthException ure) {
                // Drive scope needs an extra consent screen — launch the
                // recovery intent on the UI thread, retry token fetch on OK.
                Log.w(TAG, "onSignInResult: needs additional consent — launching recovery intent");
                final Intent recoveryIntent = ure.getIntent();
                if (recoveryIntent == null) {
                    ret.put("ok", false);
                    ret.put("reason", "needs-additional-consent");
                    call.resolve(ret);
                    return;
                }
                getActivity().runOnUiThread(() ->
                    startActivityForResult(call, recoveryIntent, "onTokenConsentResult"));
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "token-fetch-failed" : e.getMessage();
                Log.e(TAG, "onSignInResult: token probe failed: " + msg, e);
                ret.put("ok", false);
                ret.put("reason", msg);
                call.resolve(ret);
            }
        }).start();
    }

    @ActivityCallback
    private void onTokenConsentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK) {
            Log.w(TAG, "onTokenConsentResult: consent declined (resultCode=" + result.getResultCode() + ")");
            ret.put("ok", false);
            ret.put("reason", "consent-declined");
            call.resolve(ret);
            return;
        }
        final String email = currentAccountEmail();
        if (email == null) {
            Log.w(TAG, "onTokenConsentResult: no account after consent");
            ret.put("ok", false);
            ret.put("reason", "no-account-after-consent");
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            JSObject ret2 = new JSObject();
            try {
                GoogleAuthUtil.getToken(getContext(), email, "oauth2:" + DRIVE_SCOPE);
                Log.i(TAG, "onTokenConsentResult: token OK after consent");
                ret2.put("ok", true);
                ret2.put("account", email);
                call.resolve(ret2);
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "token-retry-failed" : e.getMessage();
                Log.e(TAG, "onTokenConsentResult: token retry failed: " + msg, e);
                ret2.put("ok", false);
                ret2.put("reason", msg);
                call.resolve(ret2);
            }
        }).start();
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        // signOut() alone only clears the current session — Google still
        // remembers the account choice. revokeAccess() fully removes the
        // OAuth grant so the next sign-in shows a clean account chooser AND
        // consent screen. That is what lets "sign out and retry" escape a
        // misconfigured or partially-granted state.
        signInClient().revokeAccess().addOnCompleteListener(revokeTask ->
            signInClient().signOut().addOnCompleteListener(signOutTask -> {
                getContext().getSharedPreferences(PREFS_NAME, 0).edit().remove(PREF_KEY).apply();
                Log.i(TAG, "signOut: revokeAccess + signOut complete");
                call.resolve();
            })
        );
    }

    /**
     * Resolve the email of the currently-signed-in Google account. Falls
     * back to the SharedPreferences cache populated in onSignInResult,
     * because GoogleSignIn.getLastSignedInAccount() can briefly return null
     * after a successful sign-in on some Play Services versions.
     */
    private String currentAccountEmail() {
        GoogleSignInAccount acc = currentAccount();
        if (acc != null && acc.getEmail() != null) return acc.getEmail();
        return getContext().getSharedPreferences(PREFS_NAME, 0).getString(PREF_KEY, null);
    }

    private String fetchAccessTokenSync() throws Exception {
        String email = currentAccountEmail();
        if (email == null) throw new Exception("not-signed-in");
        // Use the email-string overload — getAccount() is deprecated and
        // returns null on modern Android, which silently breaks this flow.
        // GoogleAuthUtil.getToken is blocking; must be called off main thread.
        return GoogleAuthUtil.getToken(getContext(), email, "oauth2:" + DRIVE_SCOPE);
    }

    @PluginMethod
    public void uploadBackup(final PluginCall call) {
        final String fileName = call.getString("fileName");
        final String content = call.getString("content");
        if (TextUtils.isEmpty(fileName) || content == null) {
            call.reject("Missing fileName/content");
            return;
        }

        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                String token = fetchAccessTokenSync();
                String existingId = findFileIdSync(token, fileName);

                String boundary = "buho_boundary_" + System.currentTimeMillis();
                JSONObject metadata = new JSONObject();
                metadata.put("name", fileName);
                if (existingId == null) {
                    metadata.put("parents", new JSONArray().put(APP_DATA_PARENT));
                }

                // The content part is the encrypted envelope, which is itself
                // JSON — hence the application/json part type.
                String body =
                    "--" + boundary + "\r\n" +
                    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                    metadata.toString() + "\r\n" +
                    "--" + boundary + "\r\n" +
                    "Content-Type: application/json\r\n\r\n" +
                    content + "\r\n" +
                    "--" + boundary + "--";

                String urlStr = existingId != null
                    ? "https://www.googleapis.com/upload/drive/v3/files/" + existingId
                        + "?uploadType=multipart"
                    : DRIVE_UPLOAD_URL;

                HttpsURLConnection con = (HttpsURLConnection) new URL(urlStr).openConnection();
                con.setRequestMethod(existingId != null ? "PATCH" : "POST");
                // Some Android versions reject PATCH on HttpURLConnection — workaround:
                if (existingId != null) {
                    con.setRequestProperty("X-HTTP-Method-Override", "PATCH");
                    con.setRequestMethod("POST");
                }
                con.setRequestProperty("Authorization", "Bearer " + token);
                con.setRequestProperty("Content-Type", "multipart/related; boundary=" + boundary);
                con.setDoOutput(true);

                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                con.setFixedLengthStreamingMode(bytes.length);
                DataOutputStream out = new DataOutputStream(con.getOutputStream());
                out.write(bytes);
                out.flush();
                out.close();

                int code = con.getResponseCode();
                if (code >= 200 && code < 300) {
                    ret.put("ok", true);
                } else {
                    ret.put("ok", false);
                    ret.put("reason", "http-" + code + ": " + readErrorBody(con));
                }
                con.disconnect();
            } catch (UserRecoverableAuthException ure) {
                ret.put("ok", false);
                ret.put("reason", "auth-required");
            } catch (Exception e) {
                ret.put("ok", false);
                ret.put("reason", e.getMessage() == null ? "unknown" : e.getMessage());
            }
            call.resolve(ret);
        }).start();
    }

    @PluginMethod
    public void downloadBackup(final PluginCall call) {
        final String fileName = call.getString("fileName");
        if (TextUtils.isEmpty(fileName)) {
            call.reject("Missing fileName");
            return;
        }
        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                String token = fetchAccessTokenSync();
                String fileId = findFileIdSync(token, fileName);
                if (fileId == null) {
                    ret.put("content", JSONObject.NULL);
                    call.resolve(ret);
                    return;
                }
                URL url = new URL(DRIVE_FILES_URL + "/" + fileId + "?alt=media");
                HttpsURLConnection con = (HttpsURLConnection) url.openConnection();
                con.setRequestProperty("Authorization", "Bearer " + token);
                int code = con.getResponseCode();
                if (code != 200) {
                    ret.put("content", JSONObject.NULL);
                    ret.put("reason", "http-" + code + ": " + readErrorBody(con));
                    call.resolve(ret);
                    return;
                }
                String body = readAll(con.getInputStream());
                con.disconnect();
                ret.put("content", body);
                call.resolve(ret);
            } catch (Exception e) {
                ret.put("content", JSONObject.NULL);
                ret.put("reason", e.getMessage() == null ? "unknown" : e.getMessage());
                call.resolve(ret);
            }
        }).start();
    }

    @PluginMethod
    public void listBackups(final PluginCall call) {
        new Thread(() -> {
            JSObject ret = new JSObject();
            JSArray files = new JSArray();
            try {
                String token = fetchAccessTokenSync();
                String q = "trashed=false";
                URL url = new URL(DRIVE_FILES_URL
                    + "?spaces=appDataFolder"
                    + "&fields=" + URLEncoder.encode("files(id,name,modifiedTime,size)", "UTF-8")
                    + "&q=" + URLEncoder.encode(q, "UTF-8"));
                HttpsURLConnection con = (HttpsURLConnection) url.openConnection();
                con.setRequestProperty("Authorization", "Bearer " + token);
                int code = con.getResponseCode();
                if (code == 200) {
                    JSONObject json = new JSONObject(readAll(con.getInputStream()));
                    JSONArray arr = json.optJSONArray("files");
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject f = arr.getJSONObject(i);
                            JSObject row = new JSObject();
                            row.put("name", f.optString("name"));
                            row.put("modifiedAt", f.optString("modifiedTime"));
                            row.put("size", f.optLong("size", 0));
                            files.put(row);
                        }
                    }
                } else {
                    ret.put("reason", "http-" + code);
                    // An expired/revoked grant surfaces here first — reject
                    // with the sentinel the JS layer maps to "sign in again".
                    if (code == 401 || code == 403) {
                        call.reject("auth-required");
                        return;
                    }
                }
                con.disconnect();
                ret.put("files", files);
                call.resolve(ret);
            } catch (Exception e) {
                String msg = e.getMessage();
                if (msg != null && (msg.contains("not-signed-in") || e instanceof UserRecoverableAuthException)) {
                    call.reject("auth-required");
                    return;
                }
                ret.put("files", files);
                ret.put("reason", msg == null ? "unknown" : msg);
                call.resolve(ret);
            }
        }).start();
    }

    @PluginMethod
    public void deleteBackup(final PluginCall call) {
        final String fileName = call.getString("fileName");
        if (TextUtils.isEmpty(fileName)) {
            call.reject("Missing fileName");
            return;
        }
        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                String token = fetchAccessTokenSync();
                String fileId = findFileIdSync(token, fileName);
                if (fileId == null) {
                    ret.put("ok", true);
                    call.resolve(ret);
                    return;
                }
                URL url = new URL(DRIVE_FILES_URL + "/" + fileId);
                HttpsURLConnection con = (HttpsURLConnection) url.openConnection();
                con.setRequestMethod("DELETE");
                con.setRequestProperty("Authorization", "Bearer " + token);
                int code = con.getResponseCode();
                con.disconnect();
                if (code >= 200 && code < 300) {
                    ret.put("ok", true);
                } else {
                    ret.put("ok", false);
                    ret.put("reason", "http-" + code);
                }
                call.resolve(ret);
            } catch (Exception e) {
                ret.put("ok", false);
                ret.put("reason", e.getMessage() == null ? "unknown" : e.getMessage());
                call.resolve(ret);
            }
        }).start();
    }

    private String findFileIdSync(String token, String fileName) throws Exception {
        String q = "name = '" + fileName.replace("'", "\\'") + "' and trashed=false";
        URL url = new URL(DRIVE_FILES_URL
            + "?spaces=appDataFolder"
            + "&fields=" + URLEncoder.encode("files(id,name)", "UTF-8")
            + "&q=" + URLEncoder.encode(q, "UTF-8"));
        HttpsURLConnection con = (HttpsURLConnection) url.openConnection();
        con.setRequestProperty("Authorization", "Bearer " + token);
        int code = con.getResponseCode();
        if (code != 200) {
            String body = readErrorBody(con);
            con.disconnect();
            throw new Exception("list-failed http-" + code + ": " + body);
        }
        JSONObject json = new JSONObject(readAll(con.getInputStream()));
        con.disconnect();
        JSONArray arr = json.optJSONArray("files");
        if (arr == null || arr.length() == 0) return null;
        return arr.getJSONObject(0).optString("id", null);
    }

    private String readAll(InputStream is) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line).append('\n');
        r.close();
        return sb.toString();
    }

    private String readErrorBody(HttpURLConnection con) {
        try {
            InputStream es = con.getErrorStream();
            if (es == null) return "";
            return readAll(es);
        } catch (Exception ignored) {
            return "";
        }
    }
}
