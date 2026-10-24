package com.yorureader.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

/**
 * Keeps read-aloud going when Yoru is in the background, like a music app: a foreground service
 * (so Android does not freeze the app while the voice speaks), a media session (lock screen,
 * quick settings, headset buttons) and its notification with the player controls.
 *
 * The sentence loop stays in the web reader (useReadAloud): this service only shows what it is
 * told (ReadAloudState) and hands every button press back to it through {@link Listener}.
 * It also pauses for calls, other audio and unplugged headphones (audio focus, "noisy").
 */
public class ReadAloudService extends Service {
    private static final String TAG = "YoruReadAloud";
    static final int NOTIFICATION_ID = 7101;
    private static final String ACTION_SHOW = "com.yorureader.app.readaloud.SHOW";
    private static final String ACTION_CONTROL = "com.yorureader.app.readaloud.CONTROL";
    private static final String EXTRA_CONTROL = "control";
    /** A paused player that nobody touches goes away after this long. */
    private static final long PAUSED_TIMEOUT_MS = 15 * 60_000L;

    /** Receives the player's buttons: play, pause, next, previous, sleep, close, seek. */
    interface Listener {
        void onReadAloudAction(String action, long positionMs);
    }

    /** What the player shows. Filled by YoruNotificationsPlugin from the reader. */
    static final class ReadAloudState {
        String bookTitle = "";
        String chapter = "";
        String sentence = "";
        boolean showSentence = true;
        boolean playing = false;
        long positionMs = 0;
        long durationMs = 0;
        /** Extra line under the title: the sleep timer or an error. */
        String note = "";
        float rate = 1f;
        boolean spanish = true;
        Bitmap artwork;

        ReadAloudState copy() {
            ReadAloudState c = new ReadAloudState();
            c.bookTitle = bookTitle;
            c.chapter = chapter;
            c.sentence = sentence;
            c.showSentence = showSentence;
            c.playing = playing;
            c.positionMs = positionMs;
            c.durationMs = durationMs;
            c.note = note;
            c.rate = rate;
            c.spanish = spanish;
            c.artwork = artwork;
            return c;
        }
    }

    static volatile Listener listener;
    private static volatile ReadAloudState state = new ReadAloudState();
    private static ReadAloudService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaSession session;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private boolean hasFocus = false;
    private boolean resumeOnFocusGain = false;
    private boolean noisyRegistered = false;
    private Bitmap fallbackArtwork;
    private final Runnable pausedTimeout = this::stopSelf;

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Headphones unplugged: do not go on through the speaker.
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) dispatch("pause", 0);
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        switch (change) {
            case AudioManager.AUDIOFOCUS_GAIN:
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false;
                    dispatch("play", 0);
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // A call or a voice message: pause and come back afterwards.
                if (state.playing) {
                    resumeOnFocusGain = true;
                    dispatch("pause", 0);
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                // Another app plays music: give way for good.
                resumeOnFocusGain = false;
                hasFocus = false;
                if (state.playing) dispatch("pause", 0);
                break;
            default:
                // Ducking (navigation prompts): the voice goes on.
                break;
        }
    };

    /** Shows or refreshes the player. Starts the service the first time (the app is in front then). */
    static void show(Context context, ReadAloudState next) {
        if (next.artwork == null) next.artwork = state.artwork;
        state = next;
        ReadAloudService running = instance;
        if (running != null) {
            running.handler.post(running::render);
            return;
        }
        Intent intent = new Intent(context, ReadAloudService.class).setAction(ACTION_SHOW);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException error) {
            // Android 12+ refuses to start it from the background; the next start from the app will.
            Log.w(TAG, "Could not start the read-aloud player", error);
        }
    }

    /** The voice started a sentence (YoruTtsPlugin's queue): shows it without waiting for the page. */
    static void advance(String sentence, long positionMs, long durationMs) {
        ReadAloudState current = state;
        ReadAloudState next = current.copy();
        next.sentence = sentence == null ? "" : sentence;
        next.positionMs = positionMs;
        if (durationMs > 0) next.durationMs = durationMs;
        next.playing = true;
        state = next;
        ReadAloudService running = instance;
        if (running != null) running.handler.post(running::render);
    }

    /** The sleep timer ended read-aloud (YoruTtsPlugin's queue). */
    static void pausedBySleep() {
        ReadAloudState next = state.copy();
        next.playing = false;
        next.note = "";
        state = next;
        ReadAloudService running = instance;
        if (running != null) running.handler.post(running::render);
    }

    /** Removes the player (read-aloud stopped or closed in the app). */
    static void hide(Context context) {
        state = new ReadAloudState();
        ReadAloudService running = instance;
        if (running != null) running.handler.post(running::stopSelf);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        YoruNotifier.ensureChannels(this, state.spanish);
        session = new MediaSession(this, "YoruReadAloud");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { dispatch("play", 0); }
            @Override public void onPause() { dispatch("pause", 0); }
            @Override public void onSkipToNext() { dispatch("next", 0); }
            @Override public void onSkipToPrevious() { dispatch("previous", 0); }
            @Override public void onStop() { dispatch("close", 0); }
            @Override public void onSeekTo(long position) { dispatch("seek", position); }
            @Override public void onCustomAction(String action, android.os.Bundle extras) { dispatch(action, 0); }
        });
        PendingIntent open = openAppIntent();
        if (open != null) session.setSessionActivity(open);
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // startForeground first, whatever the intent: Android stops the app if it comes late.
        render();
        if (intent != null && ACTION_CONTROL.equals(intent.getAction())) {
            dispatch(intent.getStringExtra(EXTRA_CONTROL), 0);
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The app was swiped away: the reader that drives the voice is gone.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        setNoisyReceiver(false);
        abandonFocus();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        if (instance == this) instance = null;
        // Closed by the system or the timeout while the reader still thinks it is open.
        if (state.playing) dispatch("pause", 0);
        super.onDestroy();
    }

    private void dispatch(String action, long positionMs) {
        if (action == null) return;
        if ("close".equals(action)) state.playing = false;
        Listener current = listener;
        if (current != null) {
            current.onReadAloudAction(action, positionMs);
        } else if (!"pause".equals(action)) {
            // Nobody left to read: the web reader is gone.
            stopSelf();
        }
    }

    private void render() {
        ReadAloudState s = state;
        YoruNotifier.ensureChannels(this, s.spanish);
        updateSession(s);
        Notification notification = buildNotification(s);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not show the read-aloud player", error);
            stopSelf();
            return;
        }
        if (s.playing) {
            requestFocus();
            setNoisyReceiver(true);
            handler.removeCallbacks(pausedTimeout);
        } else {
            setNoisyReceiver(false);
            handler.removeCallbacks(pausedTimeout);
            handler.postDelayed(pausedTimeout, PAUSED_TIMEOUT_MS);
        }
    }

    private String titleLine(ReadAloudState s) {
        if (s.showSentence && !s.sentence.isEmpty()) return s.sentence;
        return s.bookTitle.isEmpty() ? "Yoru Reader" : s.bookTitle;
    }

    private String subtitleLine(ReadAloudState s) {
        StringBuilder line = new StringBuilder();
        if (s.showSentence && !s.sentence.isEmpty()) line.append(s.bookTitle);
        if (!s.chapter.isEmpty()) {
            if (line.length() > 0) line.append(" · ");
            line.append(s.chapter);
        }
        if (!s.note.isEmpty()) {
            if (line.length() > 0) line.append(" · ");
            line.append(s.note);
        }
        return line.toString();
    }

    private Bitmap artwork(ReadAloudState s) {
        if (s.artwork != null) return s.artwork;
        if (fallbackArtwork == null) {
            fallbackArtwork = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        }
        return fallbackArtwork;
    }

    private void updateSession(ReadAloudState s) {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, titleLine(s))
            .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitleLine(s))
            .putString(MediaMetadata.METADATA_KEY_ALBUM, s.bookTitle)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, Math.max(0, s.durationMs));
        Bitmap art = artwork(s);
        if (art != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(metadata.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
            | PlaybackState.ACTION_STOP;
        if (s.durationMs > 0) actions |= PlaybackState.ACTION_SEEK_TO;
        PlaybackState.Builder playback = new PlaybackState.Builder()
            .setActions(actions)
            // The bar moves on its own between sentences at the estimated speed of the voice.
            .setState(s.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                Math.max(0, s.positionMs), s.playing ? Math.max(0.25f, s.rate) : 0f)
            .addCustomAction(new PlaybackState.CustomAction.Builder("sleep", label(s, "sleep"), R.drawable.ic_ra_sleep).build())
            .addCustomAction(new PlaybackState.CustomAction.Builder("close", label(s, "close"), R.drawable.ic_ra_close).build());
        session.setPlaybackState(playback.build());
    }

    private Notification buildNotification(ReadAloudState s) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, YoruNotifier.CHANNEL_READ_ALOUD)
            : new Notification.Builder(this);
        builder.setSmallIcon(R.drawable.ic_stat_yoru)
            .setContentTitle(titleLine(s))
            .setContentText(subtitleLine(s))
            .setLargeIcon(artwork(s))
            .setColor(YoruNotifier.ACCENT)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(s.playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(action(s, "sleep", R.drawable.ic_ra_sleep))
            .addAction(action(s, "previous", R.drawable.ic_ra_prev))
            .addAction(s.playing ? action(s, "pause", R.drawable.ic_ra_pause) : action(s, "play", R.drawable.ic_ra_play))
            .addAction(action(s, "next", R.drawable.ic_ra_next))
            .addAction(action(s, "close", R.drawable.ic_ra_close))
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(1, 2, 3));
        PendingIntent open = openAppIntent();
        if (open != null) builder.setContentIntent(open);
        builder.setDeleteIntent(controlIntent("close"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    private Notification.Action action(ReadAloudState s, String control, int icon) {
        return new Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(this, icon), label(s, control), controlIntent(control)).build();
    }

    private static String label(ReadAloudState s, String control) {
        boolean es = s.spanish;
        switch (control) {
            case "sleep": return es ? "Temporizador" : "Sleep timer";
            case "previous": return es ? "Oración anterior" : "Previous sentence";
            case "pause": return es ? "Pausa" : "Pause";
            case "play": return es ? "Reanudar" : "Resume";
            case "next": return es ? "Oración siguiente" : "Next sentence";
            default: return es ? "Cerrar" : "Close";
        }
    }

    private PendingIntent controlIntent(String control) {
        Intent intent = new Intent(this, ReadAloudService.class)
            .setAction(ACTION_CONTROL)
            .putExtra(EXTRA_CONTROL, control);
        return PendingIntent.getService(this, control.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent openAppIntent() {
        return YoruNotifier.openAppIntent(this, null, 0);
    }

    private void requestFocus() {
        if (hasFocus || audioManager == null) return;
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                    .setWillPauseWhenDucked(false)
                    .setOnAudioFocusChangeListener(focusListener, handler)
                    .build();
            }
            result = audioManager.requestAudioFocus(focusRequest);
        } else {
            result = audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        hasFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonFocus() {
        if (!hasFocus || audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
        } else {
            audioManager.abandonAudioFocus(focusListener);
        }
        hasFocus = false;
    }

    private void setNoisyReceiver(boolean on) {
        if (on == noisyRegistered) return;
        if (on) {
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(noisyReceiver, filter);
            }
        } else {
            try { unregisterReceiver(noisyReceiver); } catch (IllegalArgumentException ignored) { }
        }
        noisyRegistered = on;
    }
}
