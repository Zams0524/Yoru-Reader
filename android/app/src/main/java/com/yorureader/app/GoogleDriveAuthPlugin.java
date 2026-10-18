package com.yorureader.app;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;

import java.util.Arrays;

@CapacitorPlugin(name = "GoogleDriveAuth")
public class GoogleDriveAuthPlugin extends Plugin {
    private static final String DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
    private static final String EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

    @PluginMethod
    public void authorize(PluginCall call) {
        AuthorizationRequest request = new AuthorizationRequest.Builder()
            .setRequestedScopes(Arrays.asList(new Scope(DRIVE_FILE_SCOPE), new Scope(EMAIL_SCOPE)))
            .build();

        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> continueAuthorization(call, result))
            .addOnFailureListener(error -> call.reject(
                "No se pudo iniciar la autorización de Google: " + error.getMessage(), error
            ));
    }

    private void continueAuthorization(PluginCall call, AuthorizationResult result) {
        if (result.hasResolution()) {
            Intent intent = new Intent(getContext(), GoogleAuthorizationActivity.class);
            intent.putExtra(GoogleAuthorizationActivity.EXTRA_PENDING_INTENT, result.getPendingIntent());
            startActivityForResult(call, intent, "handleAuthorizationResult");
            return;
        }
        resolveAuthorization(call, result);
    }

    @ActivityCallback
    private void handleAuthorizationResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        if (data == null) {
            call.reject(
                "Google Play Services no devolvió una respuesta de autorización (código "
                    + activityResult.getResultCode() + ")."
            );
            return;
        }

        try {
            // Google encodes the authorization result in the returned Intent. Read it
            // before interpreting resultCode: the outer Capacitor activity result is
            // not the source of truth for whether Google returned a usable token.
            AuthorizationResult result = Identity.getAuthorizationClient(getActivity())
                .getAuthorizationResultFromIntent(data);
            resolveAuthorization(call, result);
        } catch (ApiException error) {
            int statusCode = error.getStatusCode();
            if (statusCode == CommonStatusCodes.CANCELED) {
                call.reject("Se canceló la autorización de Google Drive.");
                return;
            }
            String statusMessage = error.getStatus() != null
                ? error.getStatus().getStatusMessage()
                : null;
            call.reject(
                "Google Drive rechazó la autorización (código " + statusCode + ")"
                    + (statusMessage == null || statusMessage.isEmpty() ? "." : ": " + statusMessage),
                error
            );
        } catch (Exception error) {
            call.reject("No se pudo leer la respuesta de autorización de Google: " + error.getMessage(), error);
        }
    }

    private void resolveAuthorization(PluginCall call, AuthorizationResult result) {
        String accessToken = result.getAccessToken();
        if (accessToken == null || accessToken.isEmpty()) {
            call.reject("Google no devolvió un token de acceso para Drive.");
            return;
        }

        JSObject response = new JSObject();
        response.put("accessToken", accessToken);
        // Renew early: Google access tokens typically last about one hour.
        response.put("expiresInSeconds", 3300);
        call.resolve(response);
    }
}
