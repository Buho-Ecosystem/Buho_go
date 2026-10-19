package org.capacitor.quasar.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * WalletAppsPlugin: which installed apps can open a link of a given scheme.
 *
 * "Connect a wallet" offers a wallet app on the same phone only when one can
 * open a connection request (nostr+walletauth), and names it. The system
 * shows such apps only to schemes declared in the manifest's <queries>
 * (package visibility, Android 11+), so every scheme asked for here must be
 * listed there too.
 *
 * Methods exposed to JS:
 *   - handlers({ url }) → { apps: [{ name, packageName }] }, BuhoGO itself left out
 */
@CapacitorPlugin(name = "WalletApps")
public class WalletAppsPlugin extends Plugin {

    @PluginMethod
    public void handlers(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Must supply a url");
            return;
        }

        PackageManager pm = getContext().getPackageManager();
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        List<ResolveInfo> found = pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);

        String self = getContext().getPackageName();
        JSArray apps = new JSArray();
        for (ResolveInfo info : found) {
            String packageName = info.activityInfo.packageName;
            if (self.equals(packageName)) continue;
            JSObject app = new JSObject();
            app.put("name", String.valueOf(info.loadLabel(pm)));
            app.put("packageName", packageName);
            apps.put(app);
        }

        JSObject result = new JSObject();
        result.put("apps", apps);
        call.resolve(result);
    }
}
