package org.capacitor.quasar.app;

import android.content.SharedPreferences;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * SecureScreenPlugin — controls Android's FLAG_SECURE on the activity window.
 *
 * When FLAG_SECURE is set the OS:
 *   - Blocks system screenshots (silently fail to capture)
 *   - Renders the window as black inside screen recordings
 *   - Shows a blank panel in the app switcher / recents thumbnail
 *   - Refuses to mirror the window to non-secure external displays
 *
 * Persistence model:
 *
 *   The user's preference is stored in this plugin's own
 *   SharedPreferences file ({@link #PREFS_FILE} / {@link #PREF_KEY_ENABLED}).
 *   Owning the storage here — instead of reading the WebView's localStorage
 *   — means {@link MainActivity#onCreate} can read the value synchronously
 *   on cold start, before the WebView loads, and apply the flag before
 *   the first frame is rendered. There is no unprotected window where
 *   content could be captured between activity start and JS boot.
 *
 * Source-of-truth model:
 *
 *   This plugin owns the persisted value. The JS / Pinia layer caches it
 *   for reactive UI but writes flow native → through this plugin →
 *   SharedPreferences. {@link MainActivity} reads SharedPreferences
 *   directly on cold start and on resume.
 *
 * Default:
 *
 *   When no preference has been written yet (fresh install), the flag is
 *   ON. Enterprise-grade fail-secure: a user has to make a deliberate
 *   choice to turn the protection off.
 *
 * Methods exposed to JS:
 *   - setEnabled({ enabled: boolean })  — persists + applies on UI thread
 *   - applyTransient({ enabled: boolean }) — applies WITHOUT persisting
 *       (used by the router-meta forceSecure override on sensitive pages)
 *   - isEnabled()                       — returns the persisted value
 */
@CapacitorPlugin(name = "SecureScreen")
public class SecureScreenPlugin extends Plugin {

    /** SharedPreferences file shared with MainActivity for cold-start reads. */
    public static final String PREFS_FILE = "BuhoGoSecurity";

    /** Key holding the user's screen-privacy preference. */
    public static final String PREF_KEY_ENABLED = "privacyScreenEnabled";

    /**
     * Default applied when no preference has been persisted yet.
     * Fail-secure: protection is on by default; opt-out is explicit.
     */
    public static final boolean DEFAULT_ENABLED = true;

    /**
     * Read the persisted preference. Used by {@link MainActivity} on
     * cold start AND on resume, and by this plugin's isEnabled().
     *
     * Synchronous SharedPreferences read is safe on the main thread —
     * SharedPreferences caches its in-memory copy after first read,
     * and we touch one boolean key.
     */
    public static boolean readPersistedPreference(android.content.Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_FILE, android.content.Context.MODE_PRIVATE);
        return prefs.getBoolean(PREF_KEY_ENABLED, DEFAULT_ENABLED);
    }

    /**
     * Apply the FLAG_SECURE bit to the activity window. Must run on the
     * UI thread (Window flag mutations are UI-thread-only). Idempotent —
     * setting an already-set flag is a no-op, same for clear.
     */
    public static void applyFlagToWindow(android.app.Activity activity, boolean enabled) {
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            if (enabled) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
        });
    }

    /**
     * Persist the preference AND apply the flag. Called by the JS
     * settings toggle. Persists first so a crash between persist and
     * apply still has the right state on next launch.
     */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Missing required parameter: enabled (boolean)");
            return;
        }

        // Persist first. apply() is async write-behind but the in-memory
        // SharedPreferences value updates synchronously, so a subsequent
        // readPersistedPreference() in this process sees the new value
        // immediately.
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_FILE, android.content.Context.MODE_PRIVATE);
        prefs.edit().putBoolean(PREF_KEY_ENABLED, enabled).apply();

        applyFlagToWindow(getActivity(), enabled);

        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    /**
     * Apply the flag WITHOUT touching the persisted preference. Used
     * by the router-meta forceSecure override so that visiting a
     * sensitive route (e.g. recovery-phrase reveal) sets FLAG_SECURE
     * regardless of the user's toggle, and leaving the route restores
     * the user's actual preference without ever mutating it.
     */
    @PluginMethod
    public void applyTransient(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Missing required parameter: enabled (boolean)");
            return;
        }

        applyFlagToWindow(getActivity(), enabled);

        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    /**
     * Return the persisted preference so the JS layer can hydrate its
     * Pinia store from the source of truth at boot.
     */
    @PluginMethod
    public void isEnabled(PluginCall call) {
        boolean enabled = readPersistedPreference(getContext());
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }
}
