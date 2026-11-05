package org.capacitor.quasar.app;

/** The Receive tile: opens Receive, the same as Home's Receive button. */
public final class ReceiveTileService extends ActionTileService {

    @Override
    protected String kind() {
        return OpenActionIntents.KIND_RECEIVE;
    }

    @Override
    protected int defaultLabel() {
        return R.string.quick_access_tile_receive;
    }
}
