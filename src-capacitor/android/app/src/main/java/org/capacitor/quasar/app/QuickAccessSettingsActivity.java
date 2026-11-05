package org.capacitor.quasar.app;

import android.app.Activity;
import android.os.Bundle;

/**
 * Long-pressing a BuhoGO tile in Quick Settings opens the app's Quick access
 * settings instead of the system's App info page. No window of its own: it
 * hands over to {@link MainActivity} with the quick-access open action and
 * finishes.
 */
public class QuickAccessSettingsActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startActivity(OpenActionIntents.forAction(
            this, OpenActionIntents.KIND_QUICK_ACCESS, null, OpenActionIntents.SOURCE_TILE));
        finish();
    }
}
