package com.yorureader.app;

import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Japanese text-to-speech through the Android system engine. The WebView has no
 * speechSynthesis voices, so word audio had no way to play on Android.
 */
@CapacitorPlugin(name = "YoruTts")
public class YoruTtsPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ready = false;
    private boolean initFailed = false;
    private final List<PluginCall> waitingCalls = new ArrayList<>();
    private final Map<String, PluginCall> pendingUtterances = new ConcurrentHashMap<>();

    @Override
    public void load() {
        startEngine();
    }

    private void startEngine() {
        initFailed = false;
        tts = new TextToSpeech(getContext(), status -> {
            synchronized (waitingCalls) {
                if (status == TextToSpeech.SUCCESS) {
                    ready = true;
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) {
                            PluginCall call = pendingUtterances.remove(utteranceId);
                            if (call != null) call.resolve();
                        }

                        @Override
                        public void onError(String utteranceId) {
                            PluginCall call = pendingUtterances.remove(utteranceId);
                            if (call != null) call.reject("TTS_ERROR");
                        }

                        @Override
                        public void onStop(String utteranceId, boolean interrupted) {
                            PluginCall call = pendingUtterances.remove(utteranceId);
                            if (call != null) call.resolve();
                        }
                    });
                } else {
                    initFailed = true;
                }
                for (PluginCall waiting : waitingCalls) {
                    if (ready) speakNow(waiting);
                    else waiting.reject("TTS_UNAVAILABLE");
                }
                waitingCalls.clear();
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("EMPTY_TEXT");
            return;
        }
        synchronized (waitingCalls) {
            if (ready) {
                speakNow(call);
            } else if (initFailed) {
                call.reject("TTS_UNAVAILABLE");
            } else {
                waitingCalls.add(call);
            }
        }
    }

    private void speakNow(PluginCall call) {
        int languageStatus = tts.setLanguage(Locale.JAPAN);
        if (languageStatus == TextToSpeech.LANG_MISSING_DATA || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
            call.reject("JAPANESE_VOICE_MISSING");
            return;
        }
        pickVoice(call.getString("voice", ""));

        Float rate = call.getFloat("rate", 1.0f);
        tts.setSpeechRate(rate == null ? 1.0f : Math.max(0.25f, Math.min(3.0f, rate)));
        tts.setPitch(1.0f);

        String utteranceId = UUID.randomUUID().toString();
        pendingUtterances.put(utteranceId, call);
        int result = tts.speak(call.getString("text"), TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        if (result != TextToSpeech.SUCCESS) {
            pendingUtterances.remove(utteranceId);
            call.reject("TTS_ERROR");
        }
    }

    /** Prefers an offline Japanese voice whose name matches the hint ("male", "female"...). */
    private void pickVoice(String hint) {
        try {
            if (tts.getVoices() == null) return;
            Voice best = null;
            for (Voice voice : tts.getVoices()) {
                if (voice.getLocale() == null || !"ja".equals(voice.getLocale().getLanguage())) continue;
                if (voice.getFeatures() != null && voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                boolean matchesHint = hint != null && !hint.isEmpty() && voice.getName().toLowerCase(Locale.ROOT).contains(hint.toLowerCase(Locale.ROOT));
                if (best == null || matchesHint || (!voice.isNetworkConnectionRequired() && best.isNetworkConnectionRequired())) {
                    best = voice;
                    if (matchesHint) break;
                }
            }
            if (best != null) tts.setVoice(best);
        } catch (RuntimeException ignored) {
            // Some engines throw from getVoices(); the language set above is enough.
        }
    }

    /** Japanese voices of the default engine, for the voice picker. */
    @PluginMethod
    public void getVoices(PluginCall call) {
        synchronized (waitingCalls) {
            if (!ready) {
                if (initFailed) {
                    call.reject("TTS_UNAVAILABLE");
                } else {
                    // Answer once the engine is up.
                    bridge.execute(() -> {
                        try { Thread.sleep(800); } catch (InterruptedException ignored) { }
                        getVoices(call);
                    });
                }
                return;
            }
        }
        JSArray list = new JSArray();
        try {
            if (tts.getVoices() != null) {
                for (Voice voice : tts.getVoices()) {
                    if (voice.getLocale() == null || !"ja".equals(voice.getLocale().getLanguage())) continue;
                    JSObject item = new JSObject();
                    item.put("name", voice.getName());
                    item.put("network", voice.isNetworkConnectionRequired());
                    item.put("installed", voice.getFeatures() == null
                        || !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED));
                    list.put(item);
                }
            }
        } catch (RuntimeException ignored) {
            // Some engines throw from getVoices(); an empty list is fine.
        }
        JSObject response = new JSObject();
        response.put("voices", list);
        response.put("engine", tts.getDefaultEngine());
        call.resolve(response);
    }

    /** Opens the system text-to-speech settings (to download more voices). */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent("com.android.settings.TTS_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("SETTINGS_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject response = new JSObject();
        boolean available = ready && tts.isLanguageAvailable(Locale.JAPAN) >= TextToSpeech.LANG_AVAILABLE;
        response.put("available", available);
        call.resolve(response);
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.handleOnDestroy();
    }
}
