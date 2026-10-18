package org.capacitor.quasar.app;

import android.app.UiModeManager;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The launch hand-over between the system splash and the app's first frame.
 *
 * The splash (styles.xml, AppTheme.NoActionBarLaunch) and the app's launch
 * frame (src/components/LaunchMark.vue, index.html) draw the same picture:
 * the mark, centred, on the home screen's background. MainActivity installs
 * the splash and holds it ({@link #hold}) until JavaScript says that picture
 * is on screen ({@code ready}), then removes it at once, without the system's
 * exit animation, so nothing visibly changes at the seam. {@code ready}
 * resolves only once the splash is gone, so the app moves nothing that the
 * splash still covers. The hold never outlasts {@link #MAX_HOLD_MS}: a page
 * that fails to load still appears.
 *
 * {@code setNightMode} keeps the next splash in the app's own theme: BuhoGO
 * picks light or dark itself (boot/theme.js) rather than following the
 * system, and on Android 12 and later the splash follows the app's night
 * mode. Earlier versions follow the system.
 */
@CapacitorPlugin(name = "Launch")
public class LaunchPlugin extends Plugin {

    /**
     * The longest the splash waits for the app's first frame: a safety net
     * for a page that never loads, long enough for a slow phone's cold start.
     */
    static final long MAX_HOLD_MS = 8000;
    /** Let the build-up (drawable-v31/launch_icon.xml) finish before it goes. */
    static final long MIN_HOLD_MS = 820;

    private static volatile boolean webReady = false;
    private static long heldSince = 0;
    private static boolean splashGone = false;
    private static PluginCall waitingForSplash = null;

    /** Called from MainActivity.onCreate, before super.onCreate(). */
    static void hold(SplashScreen splash) {
        webReady = false;
        synchronized (LaunchPlugin.class) {
            splashGone = false;
            waitingForSplash = null;
        }
        heldSince = SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(() -> {
            long held = SystemClock.uptimeMillis() - heldSince;
            if (held >= MAX_HOLD_MS) return false;
            return !webReady || held < minHoldMs();
        });
        // The app draws the very same picture underneath: no exit animation.
        splash.setOnExitAnimationListener(provider -> {
            provider.remove();
            onSplashGone();
        });
    }

    private static synchronized void onSplashGone() {
        splashGone = true;
        if (waitingForSplash != null) {
            waitingForSplash.resolve();
            waitingForSplash = null;
        }
    }

    private static long minHoldMs() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? MIN_HOLD_MS : 0;
    }

    /** The app's first frame is on screen; resolves once the splash is gone. */
    @PluginMethod
    public void ready(PluginCall call) {
        webReady = true;
        synchronized (LaunchPlugin.class) {
            if (splashGone) {
                call.resolve();
            } else {
                if (waitingForSplash != null) waitingForSplash.resolve();
                waitingForSplash = call;
            }
        }
    }

    @PluginMethod
    public void setNightMode(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            call.reject("Needs Android 12");
            return;
        }
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        UiModeManager uiModeManager = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        if (uiModeManager == null) {
            call.reject("No UI mode service");
            return;
        }
        uiModeManager.setApplicationNightMode(dark ? UiModeManager.MODE_NIGHT_YES : UiModeManager.MODE_NIGHT_NO);
        JSObject result = new JSObject();
        result.put("dark", dark);
        call.resolve(result);
    }
}
