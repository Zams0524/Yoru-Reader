package com.yorureader.app;

import android.Manifest;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

/**
 * Notifications from the web app: the read-aloud player ({@link ReadAloudService}), the daily
 * SRS reminder and the update notices ({@link YoruNotifier}), the notification permission, and
 * which screen a tapped notification asked for.
 */
@CapacitorPlugin(
    name = "YoruNotifications",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class YoruNotificationsPlugin extends Plugin {
    private static final int MAX_ARTWORK = 320;
    private String launchAction;
    private boolean rendererRaised = false;

    @Override
    public void load() {
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        launchAction = takeAction(intent);
        ReadAloudService.listener = (action, positionMs) -> {
            JSObject event = new JSObject();
            event.put("action", action);
            event.put("positionMs", positionMs);
            notifyListeners("readAloudAction", event);
        };
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        String action = takeAction(intent);
        if (action == null) return;
        JSObject event = new JSObject();
        event.put("action", action);
        notifyListeners("launchAction", event, true);
    }

    @Override
    protected void handleOnDestroy() {
        ReadAloudService.listener = null;
        ReadAloudService.hide(getContext());
        super.handleOnDestroy();
    }

    private static String takeAction(Intent intent) {
        if (intent == null) return null;
        String action = intent.getStringExtra(YoruNotifier.EXTRA_ACTION);
        if (action != null) intent.removeExtra(YoruNotifier.EXTRA_ACTION);
        return action;
    }

    /** The screen the notification that opened the app asked for (srs, updates), once. */
    @PluginMethod
    public void getLaunchAction(PluginCall call) {
        JSObject result = new JSObject();
        result.put("action", launchAction);
        launchAction = null;
        call.resolve(result);
    }

    // ---- Permission (Android 13+ asks; before that notifications are on unless turned off) ----

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        String state;
        if (YoruNotifier.enabled(getContext())) state = "granted";
        else if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) state = "prompt";
        else state = "denied";
        result.put("notifications", state);
        call.resolve(result);
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "permissionResult");
        } else {
            checkPermissions(call);
        }
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        checkPermissions(call);
    }

    /** Android's notification settings for Yoru (to turn them back on after saying no). */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getContext().getPackageName(), null));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("SETTINGS_UNAVAILABLE");
        }
    }

    // ---- Read aloud ----

    /** Shows or refreshes the player: the sentence, the book, play/pause and where it goes. */
    @PluginMethod
    public void updateReadAloud(PluginCall call) {
        ReadAloudService.ReadAloudState state = new ReadAloudService.ReadAloudState();
        state.bookTitle = call.getString("bookTitle", "");
        state.chapter = call.getString("chapter", "");
        state.sentence = call.getString("sentence", "");
        state.showSentence = Boolean.TRUE.equals(call.getBoolean("showSentence", true));
        state.playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        // getLong only takes values that arrived as Long; small numbers come as Integer.
        state.positionMs = call.getData().optLong("positionMs", 0L);
        state.durationMs = call.getData().optLong("durationMs", 0L);
        state.note = call.getString("note", "");
        Float rate = call.getFloat("rate", 1f);
        state.rate = rate == null ? 1f : rate;
        state.spanish = !"en".equals(call.getString("lang", "es"));
        String artwork = call.getString("artwork", null);
        if (artwork != null && !artwork.isEmpty()) state.artwork = decodeArtwork(artwork);
        keepRendererAwake();
        ReadAloudService.show(getContext(), state);
        call.resolve();
    }

    @PluginMethod
    public void stopReadAloud(PluginCall call) {
        ReadAloudService.hide(getContext());
        call.resolve();
    }

    /**
     * The voice is driven from the page: while Yoru is in the background the WebView's renderer
     * must keep the app's priority (the foreground service) instead of dropping to a background one.
     */
    private void keepRendererAwake() {
        if (rendererRaised || Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getBridge() == null) return;
        rendererRaised = true;
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (webView != null) webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        });
    }

    private static Bitmap decodeArtwork(String dataUrl) {
        try {
            int comma = dataUrl.indexOf(',');
            byte[] bytes = Base64.decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) return null;
            int largest = Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (largest <= MAX_ARTWORK) return bitmap;
            float scale = MAX_ARTWORK / (float) largest;
            return Bitmap.createScaledBitmap(bitmap, Math.round(bitmap.getWidth() * scale), Math.round(bitmap.getHeight() * scale), true);
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    // ---- SRS reminder ----

    /** entries: [{at (ms), title, body}] for the coming days; an empty list turns the reminder off. */
    @PluginMethod
    public void setSrsReminders(PluginCall call) {
        YoruNotifier.setSpanish(getContext(), !"en".equals(call.getString("lang", "es")));
        JSArray entries = call.getArray("entries", new JSArray());
        try {
            YoruNotifier.setSrsSchedule(getContext(), new JSONArray(entries.toString()));
        } catch (JSONException error) {
            YoruNotifier.setSrsSchedule(getContext(), new JSONArray());
        }
        call.resolve();
    }

    /** Removes the reminder that is showing (the reviews are done). */
    @PluginMethod
    public void clearSrsNotification(PluginCall call) {
        YoruNotifier.clearSrs(getContext());
        call.resolve();
    }

    // ---- Updates ----

    @PluginMethod
    public void configureUpdates(PluginCall call) {
        YoruNotifier.setSpanish(getContext(), !"en".equals(call.getString("lang", "es")));
        YoruNotifier.configureUpdates(getContext(),
            Boolean.TRUE.equals(call.getBoolean("apk", true)),
            Boolean.TRUE.equals(call.getBoolean("ota", false)),
            call.getString("webVersion", ""));
        call.resolve();
    }
}
