package org.capacitor.quasar.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.Log;
import android.util.LruCache;

import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Icons for the launcher shortcuts (issue #446).
 *
 * Scan QR, Receive and Send use bundled adaptive icons. A contact shows their
 * picture, the one their card shows in the app, as an adaptive bitmap the
 * launcher masks to its own shape; without a picture, or when it cannot be
 * fetched, the app's grey placeholder (a person, or a storefront for a
 * service).
 *
 * A picture's address is set by the contact, so the fetch is bounded: https
 * only (redirects included), 2 MB, and one deadline for the whole fetch,
 * after which the connection is dropped. A host that answers slowly or never
 * costs one deadline, and is then not asked again for a while. Pictures are
 * kept in memory, so a contact who stays the last one paid is fetched once,
 * not on every update. Call from a worker thread.
 */
final class ShortcutIcons {

    private static final String TAG = "BuhoQuickAccess";

    private static final int CONNECT_TIMEOUT_MS = 4000;
    private static final int READ_TIMEOUT_MS = 4000;
    /** The whole fetch, DNS to decode: a host dripping bytes cannot hold it longer. */
    private static final long FETCH_DEADLINE_MS = 8000;
    /** A picture that failed is not fetched again before this. */
    private static final long RETRY_AFTER_MS = 10 * 60 * 1000;
    private static final int MAX_PICTURE_BYTES = 2 * 1024 * 1024;
    /** Upper bound for the bitmap, whatever the launcher reports. */
    private static final int MAX_ICON_PX = 288;

    private final Context context;
    private final LruCache<String, Bitmap> pictures = new LruCache<>(16);
    private final LruCache<String, Long> failedAt = new LruCache<>(32);
    /** Fetches run here so the caller can stop waiting at the deadline. */
    private final ExecutorService fetcher = Executors.newCachedThreadPool();

    ShortcutIcons(Context context) {
        this.context = context.getApplicationContext();
    }

    void shutdown() {
        fetcher.shutdownNow();
    }

    /**
     * @param icon      scan, receive, send, person or service
     * @param avatarUrl a contact's picture (https), or null for the bundled icon
     */
    IconCompat forShortcut(String icon, String avatarUrl) {
        if (avatarUrl != null) {
            Bitmap picture = picture(avatarUrl);
            if (picture != null) return IconCompat.createWithAdaptiveBitmap(picture);
        }
        return IconCompat.createWithResource(context, bundled(icon));
    }

    private static int bundled(String icon) {
        if ("scan".equals(icon)) return R.drawable.ic_shortcut_scan;
        if ("receive".equals(icon)) return R.drawable.ic_shortcut_receive;
        if ("send".equals(icon)) return R.drawable.ic_shortcut_send;
        if ("service".equals(icon)) return R.drawable.ic_shortcut_service;
        return R.drawable.ic_shortcut_person;
    }

    private Bitmap picture(String url) {
        Bitmap cached = pictures.get(url);
        if (cached != null) return cached;
        Long failed = failedAt.get(url);
        if (failed != null && SystemClock.elapsedRealtime() - failed < RETRY_AFTER_MS) return null;

        Bitmap fetched = fetchWithDeadline(url);
        if (fetched != null) {
            pictures.put(url, fetched);
            failedAt.remove(url);
        } else {
            failedAt.put(url, SystemClock.elapsedRealtime());
        }
        return fetched;
    }

    private Bitmap fetchWithDeadline(String url) {
        AtomicReference<HttpURLConnection> open = new AtomicReference<>();
        Future<Bitmap> fetch;
        try {
            fetch = fetcher.submit(() -> fetch(url, open));
        } catch (RuntimeException e) {
            return null; // shut down
        }
        try {
            return fetch.get(FETCH_DEADLINE_MS, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            Log.w(TAG, "Contact picture unavailable for its shortcut: " + e.getClass().getSimpleName());
            fetch.cancel(true);
            // A blocked read only ends when its connection is dropped.
            HttpURLConnection connection = open.get();
            if (connection != null) connection.disconnect();
            return null;
        }
    }

    private Bitmap fetch(String address, AtomicReference<HttpURLConnection> open) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(address);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return null;
            connection = (HttpURLConnection) url.openConnection();
            open.set(connection);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            // A redirect may only land on https too.
            if (!"https".equalsIgnoreCase(connection.getURL().getProtocol())) return null;
            long declared = connection.getContentLengthLong();
            if (declared > MAX_PICTURE_BYTES) return null;

            byte[] bytes = readCapped(connection.getInputStream());
            return bytes == null ? null : square(bytes, iconSize());
        } catch (Exception | OutOfMemoryError e) {
            Log.w(TAG, "Contact picture unavailable for its shortcut: " + e.getClass().getSimpleName());
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static byte[] readCapped(InputStream in) throws java.io.IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_PICTURE_BYTES) return null;
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private int iconSize() {
        int reported = Math.max(ShortcutManagerCompat.getIconMaxWidth(context), ShortcutManagerCompat.getIconMaxHeight(context));
        return Math.max(96, Math.min(reported > 0 ? reported : MAX_ICON_PX, MAX_ICON_PX));
    }

    /**
     * Decode with the longer side at no more than four times the target size
     * (whatever the picture's shape, so a huge one cannot exhaust memory),
     * then centre-crop to a square of {@code size}: the full adaptive canvas,
     * of which the launcher shows the middle.
     */
    private static Bitmap square(byte[] bytes, int size) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        int longer = Math.max(bounds.outWidth, bounds.outHeight);
        while (longer / (options.inSampleSize * 2) >= size * 2) {
            options.inSampleSize *= 2;
        }
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (decoded == null) return null;

        int side = Math.min(decoded.getWidth(), decoded.getHeight());
        int left = (decoded.getWidth() - side) / 2;
        int top = (decoded.getHeight() - side) / 2;
        Bitmap icon = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        new Canvas(icon).drawBitmap(decoded, new Rect(left, top, left + side, top + side), new Rect(0, 0, size, size), new Paint(Paint.FILTER_BITMAP_FLAG));
        if (icon != decoded) decoded.recycle();
        return icon;
    }
}
