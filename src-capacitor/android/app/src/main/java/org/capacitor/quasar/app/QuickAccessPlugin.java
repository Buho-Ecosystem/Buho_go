package org.capacitor.quasar.app;

import android.app.StatusBarManager;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.util.Log;

import androidx.annotation.RequiresApi;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * QuickAccessPlugin: the Quick Settings tiles (issue #445) and the launcher
 * shortcuts (issue #446) as JavaScript sees them.
 *
 * It carries out, it does not decide: what to publish comes from
 * src/utils/quickAccessPlan.js through src/services/quickAccess.js. Every
 * shortcut opens the app through {@link OpenActionIntents}, so its id, its
 * intent and the action JavaScript reads back always agree; a definition
 * whose id does not match its action is refused.
 *
 * Methods:
 *   getPinnedShortcuts()       ids on the Home screen, enabled or not, and pinSupported
 *   applyShortcuts({ menu, pinned, disabled })
 *   requestPinShortcut({ shortcut })   the launcher's own "Add to Home screen"
 *   reportShortcutUsed({ id })
 *   getTiles()                 canRequest (Android 13+), send, receive (added or not)
 *   requestAddTile({ kind, label })    the system's own "Add tile" dialog
 *   setTiles({ available, labels: { send, receive } })
 */
@CapacitorPlugin(name = "QuickAccess")
public class QuickAccessPlugin extends Plugin {

    private static final String TAG = "BuhoQuickAccess";

    private static final Pattern CONTACT_ID = Pattern.compile("^[A-Za-z0-9_-]{1,128}$");
    private static final int MAX_SHORT_LABEL = 40;
    private static final int MAX_LONG_LABEL = 80;

    /** Shortcut work leaves the plugin thread: a contact's picture may be fetched. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ShortcutIcons icons;

    @Override
    public void load() {
        icons = new ShortcutIcons(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdown();
        icons.shutdown();
    }

    // ── Shortcuts ───────────────────────────────────────────────────────

    @PluginMethod
    public void getPinnedShortcuts(PluginCall call) {
        Context context = getContext();
        JSArray shortcuts = new JSArray();
        try {
            for (ShortcutInfoCompat shortcut : ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_PINNED)) {
                JSObject entry = new JSObject();
                entry.put("id", shortcut.getId());
                entry.put("enabled", shortcut.isEnabled());
                shortcuts.put(entry);
            }
        } catch (RuntimeException e) {
            // A launcher or profile that refuses the query: report none, publish the menu anyway.
            Log.w(TAG, "Pinned shortcuts unreadable: " + e.getMessage());
        }
        JSObject result = new JSObject();
        result.put("pinSupported", ShortcutManagerCompat.isRequestPinShortcutSupported(context));
        result.put("shortcuts", shortcuts);
        call.resolve(result);
    }

    /**
     * In this order, so no step trips over the previous state and what
     * matters lands first: switch the pinned ones that are valid back on (a
     * disabled one cannot be published), publish the menu, switch the invalid
     * ones off, and only then bring the pinned ones outside the menu up to
     * date, the one step that may wait for contact pictures.
     */
    @PluginMethod
    public void applyShortcuts(PluginCall call) {
        JSArray menu = call.getArray("menu", new JSArray());
        JSArray pinned = call.getArray("pinned", new JSArray());
        JSArray disabled = call.getArray("disabled", new JSArray());
        worker.execute(() -> {
            try {
                Context context = getContext();
                // Enabling goes by id: no pictures needed for it.
                List<ShortcutInfoCompat> pinnedPlain = build(pinned, false);
                if (!pinnedPlain.isEmpty()) {
                    ShortcutManagerCompat.enableShortcuts(context, pinnedPlain);
                }
                List<ShortcutInfoCompat> menuShortcuts = build(menu, true);
                if (!ShortcutManagerCompat.setDynamicShortcuts(context, menuShortcuts)) {
                    // Rate-limited (the app was in the background): the next resume tries again.
                    call.reject("The launcher is not taking shortcut updates right now");
                    return;
                }
                for (int i = 0; i < disabled.length(); i++) {
                    JSONObject group = disabled.getJSONObject(i);
                    List<String> ids = strings(group.getJSONArray("ids"));
                    if (!ids.isEmpty()) {
                        ShortcutManagerCompat.disableShortcuts(context, ids, group.optString("message", ""));
                    }
                }
                Set<String> inMenu = new HashSet<>();
                for (ShortcutInfoCompat shortcut : menuShortcuts) inMenu.add(shortcut.getId());
                JSONArray pinnedOnly = new JSONArray();
                for (int i = 0; i < pinned.length(); i++) {
                    JSONObject definition = pinned.getJSONObject(i);
                    if (!inMenu.contains(definition.optString("id"))) pinnedOnly.put(definition);
                }
                if (pinnedOnly.length() > 0) {
                    ShortcutManagerCompat.updateShortcuts(context, build(pinnedOnly, true));
                }
                call.resolve();
            } catch (JSONException | RuntimeException e) {
                Log.w(TAG, "Shortcuts not updated: " + e.getMessage());
                call.reject("Could not update the shortcuts", e);
            }
        });
    }

    @PluginMethod
    public void requestPinShortcut(PluginCall call) {
        JSObject definition = call.getObject("shortcut");
        if (definition == null) {
            call.reject("Missing shortcut");
            return;
        }
        worker.execute(() -> {
            try {
                Context context = getContext();
                boolean requested = ShortcutManagerCompat.isRequestPinShortcutSupported(context)
                    && ShortcutManagerCompat.requestPinShortcut(context, build(definition, true), null);
                JSObject result = new JSObject();
                result.put("requested", requested);
                call.resolve(result);
            } catch (JSONException | RuntimeException e) {
                Log.w(TAG, "Pin request failed: " + e.getMessage());
                call.reject("Could not add the shortcut", e);
            }
        });
    }

    @PluginMethod
    public void reportShortcutUsed(PluginCall call) {
        String id = call.getString("id");
        if (id != null && !id.isEmpty()) {
            ShortcutManagerCompat.reportShortcutUsed(getContext(), id);
        }
        call.resolve();
    }

    private List<ShortcutInfoCompat> build(JSONArray definitions, boolean withPictures) throws JSONException {
        List<ShortcutInfoCompat> shortcuts = new ArrayList<>();
        for (int i = 0; i < definitions.length(); i++) {
            shortcuts.add(build(definitions.getJSONObject(i), withPictures));
        }
        return shortcuts;
    }

    /**
     * @param withPictures fetch a contact's picture for the icon; false uses
     *                     the placeholder, for calls that only need the id
     */
    private ShortcutInfoCompat build(JSONObject definition, boolean withPictures) throws JSONException {
        String action = definition.getString("action");
        String contactId = null;
        String expectedId;
        switch (action) {
            case OpenActionIntents.KIND_SCAN:
            case OpenActionIntents.KIND_RECEIVE:
            case OpenActionIntents.KIND_SEND:
                expectedId = action;
                break;
            case OpenActionIntents.KIND_PAY:
                contactId = definition.optString("contactId", "");
                if (!CONTACT_ID.matcher(contactId).matches()) throw new JSONException("Bad contact id");
                expectedId = "pay-" + contactId;
                break;
            default:
                throw new JSONException("Unknown shortcut action: " + action);
        }
        String id = definition.getString("id");
        if (!expectedId.equals(id)) throw new JSONException("Shortcut id does not match its action: " + id);

        String shortLabel = label(definition.optString("shortLabel", ""), MAX_SHORT_LABEL);
        String longLabel = label(definition.optString("longLabel", ""), MAX_LONG_LABEL);
        if (shortLabel.isEmpty()) throw new JSONException("Shortcut without a label: " + id);

        String avatarUrl = definition.optString("avatarUrl", "");
        return new ShortcutInfoCompat.Builder(getContext(), id)
            .setShortLabel(shortLabel)
            .setLongLabel(longLabel.isEmpty() ? shortLabel : longLabel)
            .setRank(Math.max(0, definition.optInt("rank", 0)))
            .setIcon(icons.forShortcut(definition.optString("icon", ""), withPictures && avatarUrl.startsWith("https://") ? avatarUrl : null))
            .setIntent(OpenActionIntents.forAction(getContext(), action, contactId, OpenActionIntents.SOURCE_SHORTCUT))
            .setActivity(new ComponentName(getContext(), MainActivity.class))
            .build();
    }

    private static String label(String value, int max) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max - 1).trim() + "…";
    }

    private static List<String> strings(JSONArray array) throws JSONException {
        List<String> values = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) values.add(array.getString(i));
        return values;
    }

    // ── Tiles ───────────────────────────────────────────────────────────

    @PluginMethod
    public void getTiles(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("canRequest", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU);
        result.put(OpenActionIntents.KIND_SEND, QuickAccessState.tileAdded(context, OpenActionIntents.KIND_SEND));
        result.put(OpenActionIntents.KIND_RECEIVE, QuickAccessState.tileAdded(context, OpenActionIntents.KIND_RECEIVE));
        call.resolve(result);
    }

    @PluginMethod
    public void setTiles(PluginCall call) {
        JSObject labels = call.getObject("labels", new JSObject());
        QuickAccessState.setTiles(
            getContext(),
            Boolean.TRUE.equals(call.getBoolean("available", false)),
            labels.optString(OpenActionIntents.KIND_SEND, ""),
            labels.optString(OpenActionIntents.KIND_RECEIVE, "")
        );
        call.resolve();
    }

    @PluginMethod
    public void requestAddTile(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveTile(call, "unsupported");
            return;
        }
        String kind = call.getString("kind", "");
        Class<?> service;
        int icon;
        int fallbackLabel;
        if (OpenActionIntents.KIND_SEND.equals(kind)) {
            service = SendTileService.class;
            icon = R.drawable.ic_tile_send;
            fallbackLabel = R.string.quick_access_tile_send;
        } else if (OpenActionIntents.KIND_RECEIVE.equals(kind)) {
            service = ReceiveTileService.class;
            icon = R.drawable.ic_tile_receive;
            fallbackLabel = R.string.quick_access_tile_receive;
        } else {
            call.reject("Unknown tile: " + kind);
            return;
        }
        String label = call.getString("label", "");
        requestTile(call, kind, service, icon, label == null || label.trim().isEmpty() ? getContext().getString(fallbackLabel) : label.trim());
    }

    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    private void requestTile(PluginCall call, String kind, Class<?> service, int icon, String label) {
        Context context = getContext();
        StatusBarManager statusBar = context.getSystemService(StatusBarManager.class);
        if (statusBar == null) {
            resolveTile(call, "failed");
            return;
        }
        statusBar.requestAddTileService(
            new ComponentName(context, service),
            label,
            Icon.createWithResource(context, icon),
            context.getMainExecutor(),
            code -> {
                if (code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED
                    || code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED) {
                    QuickAccessState.setTileAdded(context, kind, true);
                    resolveTile(call, code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ? "added" : "already-added");
                } else if (code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED) {
                    resolveTile(call, "not-added");
                } else {
                    Log.w(TAG, "Add tile request refused: " + code);
                    resolveTile(call, "failed");
                }
            }
        );
    }

    private static void resolveTile(PluginCall call, String result) {
        JSObject response = new JSObject();
        response.put("result", result);
        call.resolve(response);
    }
}
