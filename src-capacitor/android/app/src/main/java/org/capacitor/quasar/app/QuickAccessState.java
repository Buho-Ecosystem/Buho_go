package org.capacitor.quasar.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * What the Quick Settings tiles need to know while the app is not running:
 * whether they can be used (a wallet exists, kiosk mode is off), their names
 * in the app's language, and which of them the person has added.
 *
 * JavaScript writes the first two through {@link QuickAccessPlugin#setTiles}
 * (composables/useQuickAccessSync.js); the tiles record the third themselves.
 *
 * Until the app has said otherwise the tiles are unavailable: a tile added
 * before the first launch after the update must not open a wallet that does
 * not exist, or a kiosk device's owner screens.
 */
final class QuickAccessState {

    private static final String PREFS_FILE = "BuhoGoQuickAccess";
    private static final String KEY_TILES_AVAILABLE = "tilesAvailable";
    private static final String KEY_TILE_LABEL = "tileLabel.";
    private static final String KEY_TILE_ADDED = "tileAdded.";

    private QuickAccessState() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
    }

    static boolean tilesAvailable(Context context) {
        return prefs(context).getBoolean(KEY_TILES_AVAILABLE, false);
    }

    /** The tile's name in the app's language, or {@code fallback} before the app has set one. */
    static String tileLabel(Context context, String kind, String fallback) {
        String label = prefs(context).getString(KEY_TILE_LABEL + kind, null);
        return label == null || label.trim().isEmpty() ? fallback : label;
    }

    static boolean tileAdded(Context context, String kind) {
        return prefs(context).getBoolean(KEY_TILE_ADDED + kind, false);
    }

    static void setTiles(Context context, boolean available, String sendLabel, String receiveLabel) {
        prefs(context).edit()
            .putBoolean(KEY_TILES_AVAILABLE, available)
            .putString(KEY_TILE_LABEL + OpenActionIntents.KIND_SEND, sendLabel)
            .putString(KEY_TILE_LABEL + OpenActionIntents.KIND_RECEIVE, receiveLabel)
            .apply();
    }

    static void setTileAdded(Context context, String kind, boolean added) {
        prefs(context).edit().putBoolean(KEY_TILE_ADDED + kind, added).apply();
    }
}
