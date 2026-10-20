package com.yorureader.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.util.Log;
import android.view.Window;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    static final String CRASH_REPORT_FILE = "yoru-last-crash.txt";
    private static final String TAG = "YoruReaderCrash";
    // Matches the bottom of the Android bottom navigation bar (yoru-design-system.css).
    private static final int APP_BACKGROUND_COLOR = Color.rgb(12, 14, 19);

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        installCrashReportHandler();
        // Picks the downloaded web UI (or rolls back a broken one) before the bridge loads it.
        WebUpdaterPlugin.prepareForLaunch(this);
        registerPlugin(GoogleDriveAuthPlugin.class);
        registerPlugin(AndroidDiagnosticsPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(WebUpdaterPlugin.class);
        registerPlugin(YoruTtsPlugin.class);
        registerPlugin(NativeReaderPlugin.class);
        super.onCreate(savedInstanceState);
        blendSystemBarsWithApp();
    }

    /**
     * Makes the status bar and the navigation buttons sit on the app's own dark color
     * (like YouTube) instead of the theme's gray window background, and removes the
     * translucent gray scrim Android draws behind 3-button navigation.
     */
    private void blendSystemBarsWithApp() {
        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(APP_BACKGROUND_COLOR));
        window.getDecorView().setBackgroundColor(APP_BACKGROUND_COLOR);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
    }

    private void installCrashReportHandler() {
        Thread.UncaughtExceptionHandler previousHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                File report = new File(getFilesDir(), CRASH_REPORT_FILE);
                String timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss z", Locale.US).format(new Date());
                try (PrintWriter writer = new PrintWriter(new FileWriter(report, false))) {
                    writer.println("Yoru Reader Android crash");
                    writer.println("Time: " + timestamp);
                    writer.println("Device: " + Build.MANUFACTURER + " " + Build.MODEL);
                    writer.println("Android: " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")");
                    writer.println("Thread: " + thread.getName());
                    writer.println();
                    error.printStackTrace(writer);
                }
                Log.e(TAG, "Saved an uncaught crash report for the next app launch", error);
            } catch (Throwable loggingError) {
                Log.e(TAG, "Could not save the crash report", loggingError);
            }

            if (previousHandler != null) {
                previousHandler.uncaughtException(thread, error);
            } else {
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(10);
            }
        });
    }
}
