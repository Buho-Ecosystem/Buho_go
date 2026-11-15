package org.capacitor.quasar.app;

/** The Send tile: opens the Send sheet, the same as Home's Send button. */
public final class SendTileService extends ActionTileService {

    @Override
    protected String kind() {
        return OpenActionIntents.KIND_SEND;
    }

    @Override
    protected int defaultLabel() {
        return R.string.quick_access_tile_send;
    }
}
