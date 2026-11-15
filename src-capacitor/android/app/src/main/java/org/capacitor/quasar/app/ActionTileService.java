package org.capacitor.quasar.app;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * A Quick Settings tile that opens BuhoGO on one screen (issue #445).
 *
 * The tile is never a switch: it is usable (inactive, the neutral look) or
 * greyed out when there is no wallet or kiosk mode is on
 * ({@link QuickAccessState}). Its label follows the app's language; the
 * second line is the app's name. Neither ever shows a balance or a name: the
 * tile is visible on the lock screen.
 *
 * On a locked phone Android asks to unlock first. BuhoGO's own app lock then
 * still applies before the screen opens (src/pages/Wallet.vue runOpenAction).
 */
abstract class ActionTileService extends TileService {

    /** The open action this tile starts ({@link OpenActionIntents}). */
    protected abstract String kind();

    /** The tile's name before the app has set one in its own language. */
    protected abstract int defaultLabel();

    @Override
    public void onTileAdded() {
        QuickAccessState.setTileAdded(this, kind(), true);
    }

    @Override
    public void onTileRemoved() {
        QuickAccessState.setTileAdded(this, kind(), false);
    }

    @Override
    public void onStartListening() {
        // Listening means the tile is in the panel, also when it was added
        // before this app version recorded it.
        QuickAccessState.setTileAdded(this, kind(), true);
        refresh();
    }

    @Override
    public void onClick() {
        if (!QuickAccessState.tilesAvailable(this)) {
            refresh();
            return;
        }
        if (isLocked()) {
            unlockAndRun(this::open);
        } else {
            open();
        }
    }

    private void refresh() {
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(QuickAccessState.tilesAvailable(this) ? Tile.STATE_INACTIVE : Tile.STATE_UNAVAILABLE);
        tile.setLabel(QuickAccessState.tileLabel(this, kind(), getString(defaultLabel())));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(getString(R.string.app_name));
        }
        tile.updateTile();
    }

    // startActivityAndCollapse(Intent) is the only form before Android 14,
    // and throws from Android 14 on.
    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    private void open() {
        Intent intent = OpenActionIntents.forAction(this, kind(), null, OpenActionIntents.SOURCE_TILE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            PendingIntent pending = PendingIntent.getActivity(
                this,
                kind().hashCode(),
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
            startActivityAndCollapse(pending);
        } else {
            startActivityAndCollapse(intent);
        }
    }
}
