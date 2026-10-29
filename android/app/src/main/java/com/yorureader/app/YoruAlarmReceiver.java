package com.yorureader.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms of {@link YoruNotifier} (SRS reminder, "in 1 hour", daily update check) and re-arming them after a reboot or an update. */
public class YoruAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        switch (action) {
            case YoruNotifier.ACTION_SRS_ALARM:
                YoruNotifier.onSrsAlarm(context);
                break;
            case YoruNotifier.ACTION_SRS_SNOOZE:
                YoruNotifier.snoozeSrs(context, intent);
                break;
            case YoruNotifier.ACTION_SRS_REPOST:
                YoruNotifier.postSrs(context, intent.getStringExtra(YoruNotifier.EXTRA_TITLE), intent.getStringExtra(YoruNotifier.EXTRA_BODY));
                break;
            case YoruNotifier.ACTION_UPDATE_CHECK: {
                PendingResult pending = goAsync();
                new Thread(() -> {
                    try {
                        YoruNotifier.checkForUpdates(context);
                    } finally {
                        pending.finish();
                    }
                }, "YoruUpdateCheck").start();
                break;
            }
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
                // Alarms do not survive a reboot or an app update.
                YoruNotifier.armNextSrsAlarm(context);
                YoruNotifier.armUpdateChecks(context);
                break;
            default:
                break;
        }
    }
}
