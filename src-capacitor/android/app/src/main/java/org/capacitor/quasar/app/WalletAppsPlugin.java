package org.capacitor.quasar.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * WalletAppsPlugin: the wallet apps on this phone that can open a link, and
 * opening a link in one of them.
 *
 * "Connect a wallet" offers a wallet app on the same phone only when one can
 * open a connection request (nostr+walletauth), and names it. Receive offers
 * "Pay from another wallet": the apps that can pay the request, with their
 * own names and icons, and opens the one picked with the request. The system
 * shows such apps only to schemes declared in the manifest's <queries>
 * (package visibility, Android 11+), so every scheme asked for here must be
 * listed there too.
 *
 * Methods exposed to JS:
 *   - handlers({ url, icons? }) → { apps: [{ name, packageName, icon? }] },
 *     BuhoGO itself left out, one entry per app; `icon` is a PNG data URL
 *     when `icons` is true
 *   - open({ url, packageName, appOnly? }) → { opened }: opens the link in
 *     that app; false when the app cannot take it (uninstalled meanwhile).
 *     The package pins the app, so `appOnly` (a web link that must not reach
 *     the browser) needs nothing more here.
 *
 * The JS side and the other platform's plugin: services/walletApps.js.
 */
@CapacitorPlugin(name = "WalletApps")
public class WalletAppsPlugin extends Plugin {

    /** Icon edge in pixels: sharp at 64 CSS pixels on a 2x screen. */
    private static final int ICON_PX = 144;

    @PluginMethod
    public void handlers(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Must supply a url", "INVALID_ARGUMENT");
            return;
        }
        boolean withIcons = Boolean.TRUE.equals(call.getBoolean("icons", false));

        PackageManager pm = getContext().getPackageManager();
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        List<ResolveInfo> found = pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);

        String self = getContext().getPackageName();
        Set<String> seen = new HashSet<>();
        JSArray apps = new JSArray();
        for (ResolveInfo info : found) {
            String packageName = info.activityInfo.packageName;
            if (self.equals(packageName) || !seen.add(packageName)) continue;
            JSObject app = new JSObject();
            app.put("name", String.valueOf(info.loadLabel(pm)));
            app.put("packageName", packageName);
            if (withIcons) {
                String icon = iconDataUrl(info.loadIcon(pm));
                if (icon != null) app.put("icon", icon);
            }
            apps.put(app);
        }

        JSObject result = new JSObject();
        result.put("apps", apps);
        call.resolve(result);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String packageName = call.getString("packageName");
        if (url == null || url.isEmpty() || packageName == null || packageName.isEmpty()) {
            call.reject("Must supply a url and a packageName", "INVALID_ARGUMENT");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.setPackage(packageName);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        JSObject result = new JSObject();
        try {
            getContext().startActivity(intent);
            result.put("opened", true);
        } catch (ActivityNotFoundException e) {
            result.put("opened", false);
        }
        call.resolve(result);
    }

    /**
     * The app's launcher icon as a square PNG data URL, or null when it
     * cannot be drawn. An adaptive icon is drawn from its layers, unmasked,
     * so every app arrives as a full square and the page rounds them all
     * alike; drawn whole, it would carry this phone's mask (often a circle).
     */
    private static String iconDataUrl(Drawable drawable) {
        if (drawable == null) return null;
        try {
            Bitmap bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && drawable instanceof AdaptiveIconDrawable) {
                AdaptiveIconDrawable adaptive = (AdaptiveIconDrawable) drawable;
                drawLayer(canvas, adaptive.getBackground());
                drawLayer(canvas, adaptive.getForeground());
            } else {
                drawable.setBounds(0, 0, ICON_PX, ICON_PX);
                drawable.draw(canvas);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
            bitmap.recycle();
            return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * One adaptive icon layer. Layers are 108dp with the visible icon in the
     * middle 72dp, so a layer is drawn half again as large, centred.
     */
    private static void drawLayer(Canvas canvas, Drawable layer) {
        if (layer == null) return;
        int bleed = ICON_PX / 4;
        layer.setBounds(-bleed, -bleed, ICON_PX + bleed, ICON_PX + bleed);
        layer.draw(canvas);
    }
}
