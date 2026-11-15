package org.capacitor.quasar.app;

import android.webkit.CookieManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * FrameCookiesPlugin: lets one screen accept cookies set inside a frame.
 *
 * Android WebViews refuse third-party cookies by default, and the app keeps
 * that default. The Bitrefill shop runs Bitrefill's widget in a frame, and
 * the widget keeps its checkout session in a cookie, so the shop page turns
 * the setting on while it is open and off again when it leaves
 * (services/bitrefill/frameCookies.js). The setting is per WebView, not per
 * frame: scoping it to the time the shop is on screen is what keeps every
 * other remote resource the app loads from using it.
 *
 * Nothing is persisted: a new WebView starts with the default (off), so an
 * app that was killed inside the shop starts clean.
 *
 * Methods exposed to JS:
 *   - setEnabled({ enabled: boolean })
 */
@CapacitorPlugin(name = "FrameCookies")
public class FrameCookiesPlugin extends Plugin {

    @PluginMethod
    public void setEnabled(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (getActivity() == null || getBridge() == null || getBridge().getWebView() == null) {
            call.reject("WebView unavailable");
            return;
        }
        // WebView settings are changed on the UI thread.
        getActivity().runOnUiThread(() -> {
            try {
                CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(), enabled);
                JSObject result = new JSObject();
                result.put("enabled", enabled);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not change the cookie setting", error);
            }
        });
    }
}
