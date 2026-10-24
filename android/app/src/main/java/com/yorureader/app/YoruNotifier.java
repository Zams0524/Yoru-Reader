package com.yorureader.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Yoru's own notifications besides the read-aloud player: the daily SRS reminder and the
 * update notices. Everything that has to happen while the app is closed lives here and in
 * {@link YoruAlarmReceiver}; the web app only hands over what to show and when.
 *
 * SRS: the web app works out, for each of the next days, how many cards will be waiting at the
 * reminder hour if nothing is reviewed in between (an accurate count of what piles up), and
 * hands over that list. Each alarm shows the entry for its day and arms the next one. The list is
 * worked out again whenever the app is opened or left, so reviewing changes it.
 */
final class YoruNotifier {
    private static final String TAG = "YoruNotifier";
    static final String CHANNEL_READ_ALOUD = "yoru_read_aloud";
    static final String CHANNEL_SRS = "yoru_srs";
    static final String CHANNEL_UPDATES = "yoru_updates";
    static final int ACCENT = 0xFFF2C866;

    static final int SRS_NOTIFICATION_ID = 7201;
    static final int UPDATE_NOTIFICATION_ID = 7301;

    static final String EXTRA_ACTION = "yoruAction";
    static final String ACTION_SRS_ALARM = "com.yorureader.app.notify.SRS_ALARM";
    static final String ACTION_SRS_SNOOZE = "com.yorureader.app.notify.SRS_SNOOZE";
    static final String ACTION_SRS_REPOST = "com.yorureader.app.notify.SRS_REPOST";
    static final String ACTION_UPDATE_CHECK = "com.yorureader.app.notify.UPDATE_CHECK";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";

    private static final String PREFS = "yoru_notifications";
    private static final String KEY_SPANISH = "spanish";
    private static final String KEY_SRS_ENTRIES = "srs_entries";
    private static final String KEY_UPDATES_APK = "updates_apk";
    private static final String KEY_UPDATES_OTA = "updates_ota";
    private static final String KEY_WEB_VERSION = "web_version";
    private static final String KEY_NOTIFIED_CODE = "notified_version_code";
    private static final String KEY_NOTIFIED_WEB = "notified_web_version";

    private static final long SNOOZE_MS = 60 * 60_000L;
    /** An alarm Android held back (Doze) still shows its day's reminder within this window. */
    private static final long LATE_ALARM_MS = 6 * 60 * 60_000L;

    private static final String REPO = "Zams0524/Yoru-Reader";
    private static final String[] APK_MANIFESTS = {
        "https://raw.githubusercontent.com/" + REPO + "/main/mobile/mobile-stable.json",
        "https://raw.githubusercontent.com/" + REPO + "/master/mobile/mobile-stable.json",
    };
    private static final String[] OTA_MANIFESTS = {
        "https://github.com/" + REPO + "/releases/latest/download/mobile-ota.json",
        "https://raw.githubusercontent.com/" + REPO + "/main/mobile/mobile-ota.json",
    };

    private YoruNotifier() { }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean spanish(Context context) {
        return prefs(context).getBoolean(KEY_SPANISH, true);
    }

    static void setSpanish(Context context, boolean spanish) {
        prefs(context).edit().putBoolean(KEY_SPANISH, spanish).apply();
        ensureChannels(context, spanish);
    }

    /** One channel per kind, so each can be silenced from Android's settings too. Names follow the app language. */
    static void ensureChannels(Context context, boolean es) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel readAloud = new NotificationChannel(CHANNEL_READ_ALOUD,
            es ? "Lectura en voz alta" : "Read aloud", NotificationManager.IMPORTANCE_LOW);
        readAloud.setDescription(es ? "El reproductor mientras Yoru lee en voz alta" : "The player while Yoru reads aloud");
        readAloud.setShowBadge(false);
        manager.createNotificationChannel(readAloud);

        // Quiet: no sound or vibration unless the user turns them on for the channel.
        NotificationChannel srs = new NotificationChannel(CHANNEL_SRS,
            es ? "Repaso diario" : "Daily review", NotificationManager.IMPORTANCE_LOW);
        srs.setDescription(es ? "Aviso cuando empieza un nuevo día de repaso" : "Notice when a new review day starts");
        manager.createNotificationChannel(srs);

        NotificationChannel updates = new NotificationChannel(CHANNEL_UPDATES,
            es ? "Actualizaciones" : "Updates", NotificationManager.IMPORTANCE_DEFAULT);
        updates.setDescription(es ? "Versiones nuevas de Yoru" : "New versions of Yoru");
        manager.createNotificationChannel(updates);
    }

    static boolean enabled(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return manager != null && manager.areNotificationsEnabled();
    }

    /** Opens Yoru; `action` (srs, updates) tells the app where to go. */
    static PendingIntent openAppIntent(Context context, String action, int requestCode) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return null;
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (action != null) launch.putExtra(EXTRA_ACTION, action);
        return PendingIntent.getActivity(context, requestCode, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent receiverIntent(Context context, String action, int requestCode, Intent extras) {
        Intent intent = new Intent(context, YoruAlarmReceiver.class).setAction(action);
        if (extras != null) intent.putExtras(extras);
        return PendingIntent.getBroadcast(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Notification.Builder builder(Context context, String channel) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, channel)
            : new Notification.Builder(context);
        return builder.setSmallIcon(R.drawable.ic_stat_yoru).setColor(ACCENT).setAutoCancel(true);
    }

    // ---- SRS ----

    /** Replaces the list of upcoming reminders ({at, title, body}, oldest first) and arms the next one. */
    static void setSrsSchedule(Context context, JSONArray entries) {
        prefs(context).edit().putString(KEY_SRS_ENTRIES, entries == null ? "[]" : entries.toString()).apply();
        armNextSrsAlarm(context);
    }

    static void armNextSrsAlarm(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent alarm = receiverIntent(context, ACTION_SRS_ALARM, 1, null);
        alarms.cancel(alarm);
        long now = System.currentTimeMillis();
        JSONArray entries = srsEntries(context);
        for (int i = 0; i < entries.length(); i++) {
            long at = entries.optJSONObject(i) == null ? 0 : entries.optJSONObject(i).optLong("at");
            if (at > now) {
                // Inexact is fine (a few minutes late at most) and needs no special permission.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm);
                return;
            }
        }
    }

    private static JSONArray srsEntries(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY_SRS_ENTRIES, "[]"));
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    /** The alarm went off: shows the reminder of the entry that is due now and arms the next one. */
    static void onSrsAlarm(Context context) {
        long now = System.currentTimeMillis();
        JSONArray entries = srsEntries(context);
        JSONObject due = null;
        JSONArray later = new JSONArray();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry == null) continue;
            long at = entry.optLong("at");
            if (at > now) later.put(entry);
            else if (now - at < LATE_ALARM_MS) due = entry;
        }
        prefs(context).edit().putString(KEY_SRS_ENTRIES, later.toString()).apply();
        if (due != null) postSrs(context, due.optString("title"), due.optString("body"));
        armNextSrsAlarm(context);
    }

    static void postSrs(Context context, String title, String body) {
        if (!enabled(context) || title == null || title.isEmpty()) return;
        boolean es = spanish(context);
        ensureChannels(context, es);
        Intent extras = new Intent().putExtra(EXTRA_TITLE, title).putExtra(EXTRA_BODY, body);
        Notification.Builder builder = builder(context, CHANNEL_SRS)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(openAppIntent(context, "srs", 11))
            .addAction(new Notification.Action.Builder(null, es ? "Repasar" : "Review", openAppIntent(context, "srs", 12)).build())
            .addAction(new Notification.Action.Builder(null, es ? "En 1 hora" : "In 1 hour",
                receiverIntent(context, ACTION_SRS_SNOOZE, 13, extras)).build());
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(SRS_NOTIFICATION_ID, builder.build());
    }

    static void clearSrs(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(SRS_NOTIFICATION_ID);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(receiverIntent(context, ACTION_SRS_REPOST, 14, null));
    }

    static void snoozeSrs(Context context, Intent intent) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(SRS_NOTIFICATION_ID);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Intent extras = new Intent()
            .putExtra(EXTRA_TITLE, intent.getStringExtra(EXTRA_TITLE))
            .putExtra(EXTRA_BODY, intent.getStringExtra(EXTRA_BODY));
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + SNOOZE_MS,
            receiverIntent(context, ACTION_SRS_REPOST, 14, extras));
    }

    // ---- Updates ----

    /** Which update notices are on, and the interface version the app runs (for the OTA notice). */
    static void configureUpdates(Context context, boolean apk, boolean ota, String webVersion) {
        SharedPreferences.Editor editor = prefs(context).edit()
            .putBoolean(KEY_UPDATES_APK, apk)
            .putBoolean(KEY_UPDATES_OTA, ota);
        if (webVersion != null && !webVersion.isEmpty()) editor.putString(KEY_WEB_VERSION, webVersion);
        editor.apply();
        armUpdateChecks(context);
    }

    static void armUpdateChecks(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        PendingIntent check = receiverIntent(context, ACTION_UPDATE_CHECK, 2, null);
        alarms.cancel(check);
        SharedPreferences prefs = prefs(context);
        if (!prefs.getBoolean(KEY_UPDATES_APK, false) && !prefs.getBoolean(KEY_UPDATES_OTA, false)) return;
        // Once a day; the app itself also checks every time it opens.
        alarms.setInexactRepeating(AlarmManager.RTC, System.currentTimeMillis() + AlarmManager.INTERVAL_HOUR * 3,
            AlarmManager.INTERVAL_DAY, check);
    }

    /** Runs off the main thread: looks for a new APK (and, if wanted, a new interface) and says so once. */
    static void checkForUpdates(Context context) {
        SharedPreferences prefs = prefs(context);
        if (!enabled(context)) return;
        boolean es = spanish(context);
        long installed = installedVersionCode(context);
        if (prefs.getBoolean(KEY_UPDATES_APK, false)) {
            JSONObject remote = fetchJson(APK_MANIFESTS);
            long code = remote == null ? 0 : remote.optLong("versionCode");
            if (code > installed && code != prefs.getLong(KEY_NOTIFIED_CODE, 0)) {
                String version = remote.optString("appVersion", "");
                postUpdate(context,
                    es ? "Yoru " + version + " disponible" : "Yoru " + version + " available",
                    es ? "Esta versión hay que instalarla. Tus libros y tarjetas se conservan."
                       : "This version needs to be installed. Your books and cards are kept.",
                    es ? "Descargar e instalar" : "Download and install");
                prefs.edit().putLong(KEY_NOTIFIED_CODE, code).apply();
                return;
            }
        }
        if (prefs.getBoolean(KEY_UPDATES_OTA, false)) {
            JSONObject ota = fetchJson(OTA_MANIFESTS);
            if (ota == null) return;
            String web = ota.optString("webVersion", "");
            boolean forThisApk = ota.optLong("nativeVersionCode") == installed;
            String current = prefs.getString(KEY_WEB_VERSION, "");
            if (forThisApk && isNewer(web, current) && !web.equals(prefs.getString(KEY_NOTIFIED_WEB, ""))) {
                String description = ota.optString("description", "");
                postUpdate(context,
                    es ? "Hay una mejora de Yoru" : "A Yoru improvement is ready",
                    (es ? "Se instala sola al abrir la app." : "It installs itself when you open the app.")
                        + (description.isEmpty() ? "" : " " + description),
                    es ? "Ver novedades" : "What's new");
                prefs.edit().putString(KEY_NOTIFIED_WEB, web).apply();
            }
        }
    }

    private static void postUpdate(Context context, String title, String body, String button) {
        ensureChannels(context, spanish(context));
        Notification.Builder builder = builder(context, CHANNEL_UPDATES)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(openAppIntent(context, "updates", 21))
            .addAction(new Notification.Action.Builder(null, button, openAppIntent(context, "updates", 22)).build());
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(UPDATE_NOTIFICATION_ID, builder.build());
    }

    @SuppressWarnings("deprecation")
    private static long installedVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (PackageManager.NameNotFoundException error) {
            return 0;
        }
    }

    private static JSONObject fetchJson(String[] urls) {
        for (String url : urls) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                connection.setUseCaches(false);
                connection.setInstanceFollowRedirects(true);
                if (connection.getResponseCode() != 200) continue;
                try (InputStream input = connection.getInputStream()) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    return new JSONObject(output.toString("UTF-8"));
                }
            } catch (Exception error) {
                Log.w(TAG, "Update manifest unavailable: " + url, error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        return null;
    }

    /** "1.2.8.60" newer than "1.2.8.59". */
    static boolean isNewer(String remote, String local) {
        if (remote == null || remote.isEmpty()) return false;
        if (local == null || local.isEmpty()) return true;
        String[] r = remote.replaceFirst("^v", "").split("\\.");
        String[] l = local.replaceFirst("^v", "").split("\\.");
        for (int i = 0; i < Math.max(r.length, l.length); i++) {
            int a = i < r.length ? parse(r[i]) : 0;
            int b = i < l.length ? parse(l[i]) : 0;
            if (a != b) return a > b;
        }
        return false;
    }

    private static int parse(String part) {
        try { return Integer.parseInt(part.replaceAll("\\D.*$", "")); } catch (NumberFormatException e) { return 0; }
    }
}
