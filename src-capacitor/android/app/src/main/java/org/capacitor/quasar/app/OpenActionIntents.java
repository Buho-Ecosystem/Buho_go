package org.capacitor.quasar.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * The intent that opens BuhoGO on one screen (issue #444):
 *
 *   buhogo://open/&lt;kind&gt;[?contact=&lt;address-book id&gt;]&amp;src=&lt;tile|shortcut&gt;
 *
 * delivered to {@link MainActivity}. Capacitor hands it to JavaScript as a
 * link (appUrlOpen on a running app, getLaunchUrl on a cold start), where
 * src/utils/openActions.js reads it. The two must stay in step.
 *
 * MainActivity is singleTask, so a running app receives the link in
 * onNewIntent and keeps its state; only a cold start loads the app.
 */
final class OpenActionIntents {

    private static final String SCHEME = "buhogo";
    private static final String HOST = "open";

    static final String KIND_SEND = "send";
    static final String KIND_RECEIVE = "receive";
    static final String KIND_SCAN = "scan";
    static final String KIND_PAY = "pay";
    static final String KIND_QUICK_ACCESS = "quick-access";

    static final String SOURCE_TILE = "tile";
    static final String SOURCE_SHORTCUT = "shortcut";

    private OpenActionIntents() {}

    /**
     * @param contactId the saved contact to pay; only for {@link #KIND_PAY}, else null
     */
    static Intent forAction(Context context, String kind, String contactId, String source) {
        Uri.Builder uri = new Uri.Builder().scheme(SCHEME).authority(HOST).appendPath(kind);
        if (contactId != null) {
            uri.appendQueryParameter("contact", contactId);
        }
        uri.appendQueryParameter("src", source);

        Intent intent = new Intent(Intent.ACTION_VIEW, uri.build(), context, MainActivity.class);
        // A tile starts it from a service, which has no task of its own.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    /**
     * The intent without its open link, for an activity that is handed its
     * last intent again (see MainActivity#onCreate); null when it carries no
     * open link.
     */
    static Intent withoutOpenLink(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !SCHEME.equals(data.getScheme()) || !HOST.equals(data.getHost())) return null;
        Intent plain = new Intent(intent);
        plain.setData(null);
        return plain;
    }
}
