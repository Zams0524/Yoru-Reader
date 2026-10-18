package com.yorureader.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Build;
import android.os.Bundle;

public final class GoogleAuthorizationActivity extends Activity {
    static final String EXTRA_PENDING_INTENT = "googleAuthorizationPendingIntent";
    private static final int REQUEST_AUTHORIZATION = 7314;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) return;

        PendingIntent pendingIntent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pendingIntent = getIntent().getParcelableExtra(EXTRA_PENDING_INTENT, PendingIntent.class);
        } else {
            //noinspection deprecation
            pendingIntent = getIntent().getParcelableExtra(EXTRA_PENDING_INTENT);
        }

        if (pendingIntent == null) {
            setResult(Activity.RESULT_CANCELED);
            finish();
            return;
        }

        try {
            startIntentSenderForResult(
                pendingIntent.getIntentSender(), REQUEST_AUTHORIZATION, null, 0, 0, 0
            );
        } catch (IntentSender.SendIntentException error) {
            setResult(Activity.RESULT_CANCELED);
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_AUTHORIZATION) {
            setResult(resultCode, data);
            finish();
        }
    }
}
