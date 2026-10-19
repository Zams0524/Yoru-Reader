package com.yorureader.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloads a newer APK inside the app and hands it to the system package installer.
 * Android never installs an APK silently for a normal app: the user confirms the system
 * dialog, and the first time also allows "Install unknown apps" for Yoru Reader.
 * The APK must be signed with the same key (android/keystore) to install over this one.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String UPDATE_DIR = "updates";
    private static final String APK_NAME = "Yoru-Reader-update.apk";
    private static final int MAX_REDIRECTS = 10;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean downloading = false;

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta la URL del APK.");
            return;
        }
        if (downloading) {
            call.reject("Ya se está descargando una actualización.");
            return;
        }
        downloading = true;
        executor.execute(() -> {
            try {
                File apk = downloadApk(url);
                JSObject result = describeApk(apk);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() != null ? error.getMessage() : error.toString(), error);
            } finally {
                downloading = false;
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        File apk = getApkFile();
        if (!apk.isFile()) {
            call.reject("No hay ninguna actualización descargada.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, intent, "afterUnknownSourcesSetting");
            return;
        }
        launchInstaller(call, apk);
    }

    @ActivityCallback
    private void afterUnknownSourcesSetting(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject response = new JSObject();
            response.put("status", "permission-denied");
            call.resolve(response);
            return;
        }
        launchInstaller(call, getApkFile());
    }

    private void launchInstaller(PluginCall call, File apk) {
        try {
            Context context = getContext();
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            JSObject response = new JSObject();
            response.put("status", "installer-opened");
            call.resolve(response);
        } catch (Exception error) {
            call.reject("No se pudo abrir el instalador de Android: " + error.getMessage(), error);
        }
    }

    private File getApkFile() {
        return new File(new File(getContext().getCacheDir(), UPDATE_DIR), APK_NAME);
    }

    private File downloadApk(String startUrl) throws IOException {
        File dir = new File(getContext().getCacheDir(), UPDATE_DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No se pudo crear la carpeta de descargas.");
        File target = getApkFile();
        File partial = new File(dir, APK_NAME + ".part");

        String currentUrl = startUrl;
        HttpURLConnection connection = null;
        for (int redirects = 0; ; redirects++) {
            if (redirects > MAX_REDIRECTS) throw new IOException("Demasiadas redirecciones al descargar el APK.");
            connection = (HttpURLConnection) new URL(currentUrl).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "Yoru-Reader-Android-Updater");
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("Redirección sin destino (HTTP " + status + ").");
                currentUrl = new URL(new URL(currentUrl), location).toString();
                continue;
            }
            if (status != HttpURLConnection.HTTP_OK) {
                connection.disconnect();
                throw new IOException("HTTP " + status + " al descargar el APK.");
            }
            break;
        }

        long total = connection.getContentLengthLong();
        long received = 0;
        long lastEmit = 0;
        try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(partial)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                received += read;
                long now = System.currentTimeMillis();
                if (now - lastEmit > 150) {
                    lastEmit = now;
                    emitProgress(received, total);
                }
            }
        } finally {
            connection.disconnect();
        }
        if (total > 0 && received != total) {
            partial.delete();
            throw new IOException("Descarga incompleta (" + received + " de " + total + " bytes).");
        }
        if (target.exists() && !target.delete()) throw new IOException("No se pudo reemplazar el APK anterior.");
        if (!partial.renameTo(target)) throw new IOException("No se pudo guardar el APK descargado.");
        emitProgress(received, received);
        return target;
    }

    private void emitProgress(long received, long total) {
        JSObject progress = new JSObject();
        progress.put("percent", total > 0 ? (int) Math.min(100, received * 100 / total) : -1);
        progress.put("transferred", received);
        progress.put("total", total);
        notifyListeners("downloadProgress", progress);
    }

    /** Rejects anything that is not a newer build of this same app (e.g. an HTML error page). */
    private JSObject describeApk(File apk) throws IOException {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (downloaded == null) {
            apk.delete();
            throw new IOException("El archivo descargado no es un APK válido.");
        }
        if (!getContext().getPackageName().equals(downloaded.packageName)) {
            apk.delete();
            throw new IOException("El APK descargado es de otra aplicación (" + downloaded.packageName + ").");
        }
        long downloadedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? downloaded.getLongVersionCode() : downloaded.versionCode;
        long installedCode;
        try {
            PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), 0);
            installedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? installed.getLongVersionCode() : installed.versionCode;
        } catch (PackageManager.NameNotFoundException error) {
            installedCode = 0;
        }
        if (downloadedCode <= installedCode) {
            apk.delete();
            throw new IOException("El APK descargado (" + downloaded.versionName + ") no es más nuevo que el instalado.");
        }
        JSObject result = new JSObject();
        result.put("versionName", downloaded.versionName);
        result.put("versionCode", downloadedCode);
        result.put("size", apk.length());
        return result;
    }
}
