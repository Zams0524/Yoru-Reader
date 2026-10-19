package com.yorureader.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Over-the-air updates of the web UI (dist.zip from the "latest" release), without a new APK.
 *
 * download() fetches the bundle, checks sha256 and size, unzips it under files/web-bundles and
 * stages it. The staged bundle becomes the WebView's server base path on the next launch
 * (prepareForLaunch, called by MainActivity before the bridge starts) or at once with applyNow().
 * The path is persisted under Capacitor's own "serverBasePath" key so the bridge loads it.
 *
 * Safety:
 * - A bundle is only accepted if its yoru-bundle.json names the installed APK versionCode.
 * - A new bundle is on trial until the frontend calls notifyAppReady(). If that does not happen
 *   within READY_TIMEOUT_MS, or the app is started again while still on trial (it crashed or was
 *   killed first), it is removed and the built-in bundle is used again.
 * - Installing a different APK (any versionCode change) deletes every downloaded bundle.
 */
@CapacitorPlugin(name = "WebUpdater")
public class WebUpdaterPlugin extends Plugin {
    private static final String TAG = "YoruWebUpdater";
    private static final String PREFS = "YoruWebUpdater";
    private static final String KEY_NATIVE_CODE = "nativeVersionCode";
    private static final String KEY_PENDING_PATH = "pendingPath";
    private static final String KEY_PENDING_VERSION = "pendingVersion";
    private static final String KEY_CURRENT_PATH = "currentPath";
    private static final String KEY_CURRENT_VERSION = "currentVersion";
    private static final String KEY_TRIAL = "trial";
    private static final String KEY_TRIAL_LAUNCHES = "trialLaunches";
    private static final String KEY_BAD_VERSIONS = "badVersions";
    private static final String KEY_LAST_ROLLBACK = "lastRollback";
    private static final String BUNDLES_DIR = "web-bundles";
    private static final String DOWNLOAD_NAME = "web-bundle.zip";
    private static final String BUNDLE_INFO = "yoru-bundle.json";
    private static final long READY_TIMEOUT_MS = 20000;
    private static final int MAX_REDIRECTS = 10;
    // Files `cap sync` adds next to the web build; dist.zip does not have them.
    private static final String[] CAPACITOR_SYNC_FILES = { "cordova.js", "cordova_plugins.js", "plugins" };

    private static boolean preparedThisProcess = false;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable readyTimeout = () -> {
        if (prefs(getContext()).getBoolean(KEY_TRIAL, false)) {
            Log.w(TAG, "The new web bundle did not report ready in time; going back to the built-in one");
            Bridge bridge = getBridge();
            if (bridge != null) bridge.setServerAssetPath(Bridge.DEFAULT_WEB_ASSET_DIR);
            rollback(getContext());
        }
    };
    private volatile boolean downloading = false;

    /** Chooses the web bundle for this launch. Must run before BridgeActivity.onCreate. */
    static void prepareForLaunch(Context context) {
        if (preparedThisProcess) return;
        preparedThisProcess = true;
        try {
            SharedPreferences prefs = prefs(context);
            long installed = installedVersionCode(context);
            if (prefs.getLong(KEY_NATIVE_CODE, -1) != installed) {
                // A different APK was installed: its own built-in bundle wins.
                deleteRecursive(new File(context.getFilesDir(), BUNDLES_DIR));
                prefs.edit().clear().putLong(KEY_NATIVE_CODE, installed).commit();
                setCapacitorServerPath(context, "");
                return;
            }

            String pendingPath = prefs.getString(KEY_PENDING_PATH, null);
            if (pendingPath != null) {
                if (isUsableBundle(pendingPath)) {
                    promotePending(context, 1);
                } else {
                    prefs.edit().remove(KEY_PENDING_PATH).remove(KEY_PENDING_VERSION).commit();
                }
            } else if (prefs.getBoolean(KEY_TRIAL, false)) {
                int launches = prefs.getInt(KEY_TRIAL_LAUNCHES, 0);
                if (launches >= 1) {
                    Log.w(TAG, "The new web bundle never reported ready; going back to the built-in one");
                    rollback(context);
                    return;
                }
                prefs.edit().putInt(KEY_TRIAL_LAUNCHES, launches + 1).commit();
            }

            String current = prefs.getString(KEY_CURRENT_PATH, null);
            setCapacitorServerPath(context, current != null && isUsableBundle(current) ? current : "");
        } catch (Throwable error) {
            Log.e(TAG, "Could not prepare the web bundle; using the built-in one", error);
            setCapacitorServerPath(context, "");
        }
    }

    @Override
    public void load() {
        if (prefs(getContext()).getBoolean(KEY_TRIAL, false)) {
            mainHandler.postDelayed(readyTimeout, READY_TIMEOUT_MS);
        }
    }

    @PluginMethod
    public void getState(PluginCall call) {
        SharedPreferences prefs = prefs(getContext());
        JSObject result = new JSObject();
        result.put("nativeVersionCode", installedVersionCode(getContext()));
        result.put("currentVersion", prefs.getString(KEY_CURRENT_VERSION, null));
        result.put("pendingVersion", prefs.getString(KEY_PENDING_VERSION, null));
        result.put("trial", prefs.getBoolean(KEY_TRIAL, false));
        result.put("lastRollback", prefs.getString(KEY_LAST_ROLLBACK, null));
        call.resolve(result);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String sha256 = call.getString("sha256");
        String version = call.getString("version");
        Long size = getNumber(call, "size");
        Long requiredCode = getNumber(call, "nativeVersionCode");
        if (url == null || sha256 == null || version == null || size == null || requiredCode == null) {
            call.reject("Faltan datos de la actualización (url, sha256, size, version, nativeVersionCode).");
            return;
        }
        long installed = installedVersionCode(getContext());
        if (requiredCode != installed) {
            call.reject("Esta actualización necesita la app " + requiredCode + " y está instalada la " + installed + ".");
            return;
        }
        SharedPreferences prefs = prefs(getContext());
        if (prefs.getStringSet(KEY_BAD_VERSIONS, new HashSet<>()).contains(version)) {
            call.reject("La interfaz " + version + " falló al arrancar y se descartó.");
            return;
        }
        if (version.equals(prefs.getString(KEY_PENDING_VERSION, null)) && isUsableBundle(prefs.getString(KEY_PENDING_PATH, null))) {
            call.resolve(readyResult(version));
            return;
        }
        if (downloading) {
            call.reject("Ya se está descargando una actualización.");
            return;
        }
        downloading = true;
        executor.execute(() -> {
            File zip = null;
            File target = null;
            try {
                zip = downloadVerified(url, sha256.toLowerCase(Locale.ROOT), size);
                target = new File(new File(getContext().getFilesDir(), BUNDLES_DIR),
                    version.replaceAll("[^A-Za-z0-9._-]", "_") + "-" + System.currentTimeMillis());
                unzip(zip, target);
                checkBundle(target, installed);
                copyCapacitorSyncFiles(target);
                stage(target, version);
                call.resolve(readyResult(version));
            } catch (Exception error) {
                if (target != null) deleteRecursive(target);
                call.reject(error.getMessage() != null ? error.getMessage() : error.toString(), error);
            } finally {
                if (zip != null) zip.delete();
                downloading = false;
            }
        });
    }

    /** Switches to the staged bundle now, reloading the WebView. */
    @PluginMethod
    public void applyNow(PluginCall call) {
        Context context = getContext();
        if (!isUsableBundle(prefs(context).getString(KEY_PENDING_PATH, null))) {
            call.reject("No hay ninguna actualización descargada.");
            return;
        }
        String path = promotePending(context, 1);
        setCapacitorServerPath(context, path);
        call.resolve();
        mainHandler.removeCallbacks(readyTimeout);
        mainHandler.postDelayed(readyTimeout, READY_TIMEOUT_MS);
        getBridge().setServerBasePath(path);
    }

    /** Called by the frontend once it has started; confirms a bundle that is on trial. */
    @PluginMethod
    public void notifyAppReady(PluginCall call) {
        SharedPreferences prefs = prefs(getContext());
        mainHandler.removeCallbacks(readyTimeout);
        if (prefs.getBoolean(KEY_TRIAL, false)) {
            prefs.edit().putBoolean(KEY_TRIAL, false).remove(KEY_TRIAL_LAUNCHES).commit();
        }
        JSObject result = new JSObject();
        result.put("currentVersion", prefs.getString(KEY_CURRENT_VERSION, null));
        call.resolve(result);
        executor.execute(() -> removeUnusedBundles(getContext()));
    }

    /** PluginCall.getLong only accepts values parsed as Long; JSON numbers that fit an int arrive as Integer. */
    private static Long getNumber(PluginCall call, String name) {
        Object value = call.getData().opt(name);
        return value instanceof Number ? ((Number) value).longValue() : null;
    }

    // ---- Launch-time state (static: runs before the bridge exists) ----

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void setCapacitorServerPath(Context context, String path) {
        context.getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE)
            .edit()
            .putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, path)
            .commit();
    }

    /** Makes the staged bundle the current one, on trial. Returns its path. */
    private static String promotePending(Context context, int trialLaunches) {
        SharedPreferences prefs = prefs(context);
        String path = prefs.getString(KEY_PENDING_PATH, null);
        String oldPath = prefs.getString(KEY_CURRENT_PATH, null);
        prefs.edit()
            .putString(KEY_CURRENT_PATH, path)
            .putString(KEY_CURRENT_VERSION, prefs.getString(KEY_PENDING_VERSION, null))
            .putBoolean(KEY_TRIAL, true)
            .putInt(KEY_TRIAL_LAUNCHES, trialLaunches)
            .remove(KEY_PENDING_PATH)
            .remove(KEY_PENDING_VERSION)
            .commit();
        if (oldPath != null && !oldPath.equals(path)) deleteRecursive(new File(oldPath));
        return path;
    }

    /** Drops the current bundle (marking its version as bad) and goes back to the built-in one. */
    private static void rollback(Context context) {
        SharedPreferences prefs = prefs(context);
        String version = prefs.getString(KEY_CURRENT_VERSION, null);
        String path = prefs.getString(KEY_CURRENT_PATH, null);
        Set<String> bad = new HashSet<>(prefs.getStringSet(KEY_BAD_VERSIONS, new HashSet<>()));
        if (version != null) bad.add(version);
        prefs.edit()
            .remove(KEY_CURRENT_PATH)
            .remove(KEY_CURRENT_VERSION)
            .remove(KEY_TRIAL)
            .remove(KEY_TRIAL_LAUNCHES)
            .putStringSet(KEY_BAD_VERSIONS, bad)
            .putString(KEY_LAST_ROLLBACK, version)
            .commit();
        setCapacitorServerPath(context, "");
        if (path != null) deleteRecursive(new File(path));
    }

    private static boolean isUsableBundle(String path) {
        return path != null && !path.isEmpty() && new File(path, "index.html").isFile();
    }

    private static long installedVersionCode(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception error) {
            return 0;
        }
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursive(child);
        if (!file.delete()) Log.w(TAG, "Could not delete " + file);
    }

    private static void removeUnusedBundles(Context context) {
        SharedPreferences prefs = prefs(context);
        File[] bundles = new File(context.getFilesDir(), BUNDLES_DIR).listFiles();
        if (bundles == null) return;
        String current = prefs.getString(KEY_CURRENT_PATH, null);
        String pending = prefs.getString(KEY_PENDING_PATH, null);
        for (File bundle : bundles) {
            String path = bundle.getAbsolutePath();
            if (!path.equals(current) && !path.equals(pending)) deleteRecursive(bundle);
        }
    }

    // ---- Download, verification and unpacking ----

    private JSObject readyResult(String version) {
        JSObject result = new JSObject();
        result.put("version", version);
        result.put("ready", true);
        return result;
    }

    private void stage(File target, String version) {
        SharedPreferences prefs = prefs(getContext());
        String oldPending = prefs.getString(KEY_PENDING_PATH, null);
        prefs.edit()
            .putString(KEY_PENDING_PATH, target.getAbsolutePath())
            .putString(KEY_PENDING_VERSION, version)
            .commit();
        if (oldPending != null && !oldPending.equals(target.getAbsolutePath())) deleteRecursive(new File(oldPending));
    }

    private File downloadVerified(String startUrl, String expectedSha256, long expectedSize) throws Exception {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No se pudo crear la carpeta de descargas.");
        File target = new File(dir, DOWNLOAD_NAME);

        String currentUrl = startUrl;
        HttpURLConnection connection;
        for (int redirects = 0; ; redirects++) {
            if (redirects > MAX_REDIRECTS) throw new IOException("Demasiadas redirecciones al descargar la actualización.");
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
                throw new IOException("HTTP " + status + " al descargar la actualización.");
            }
            break;
        }

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long received = 0;
        long lastEmit = 0;
        try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                received += read;
                if (received > expectedSize) throw new IOException("La descarga es más grande de lo esperado.");
                long now = System.currentTimeMillis();
                if (now - lastEmit > 150) {
                    lastEmit = now;
                    emitProgress(received, expectedSize);
                }
            }
        } catch (Exception error) {
            target.delete();
            throw error;
        } finally {
            connection.disconnect();
        }
        if (received != expectedSize) {
            target.delete();
            throw new IOException("Descarga incompleta (" + received + " de " + expectedSize + " bytes).");
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
        if (!hex.toString().equals(expectedSha256)) {
            target.delete();
            throw new IOException("La actualización descargada está dañada (sha256 no coincide).");
        }
        emitProgress(received, expectedSize);
        return target;
    }

    private void emitProgress(long received, long total) {
        JSObject progress = new JSObject();
        progress.put("percent", total > 0 ? (int) Math.min(100, received * 100 / total) : -1);
        progress.put("transferred", received);
        progress.put("total", total);
        notifyListeners("downloadProgress", progress);
    }

    private static void unzip(File zip, File target) throws IOException {
        if (!target.mkdirs()) throw new IOException("No se pudo crear la carpeta de la actualización.");
        String root = target.getCanonicalPath() + File.separator;
        try (ZipInputStream input = new ZipInputStream(new FileInputStream(zip))) {
            byte[] buffer = new byte[64 * 1024];
            ZipEntry entry;
            while ((entry = input.getNextEntry()) != null) {
                File out = new File(target, entry.getName());
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("Ruta no válida en el paquete: " + entry.getName());
                if (entry.isDirectory()) {
                    if (!out.isDirectory() && !out.mkdirs()) throw new IOException("No se pudo crear " + entry.getName());
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("No se pudo crear " + parent);
                try (OutputStream output = new FileOutputStream(out)) {
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                }
            }
        }
    }

    /** The bundle must be a full web build made for this exact APK (yoru-bundle.json, written by vite.config.ts). */
    private static void checkBundle(File dir, long installed) throws Exception {
        if (!new File(dir, "index.html").isFile()) throw new IOException("El paquete no contiene index.html.");
        File info = new File(dir, BUNDLE_INFO);
        if (!info.isFile()) throw new IOException("El paquete no indica para qué versión de la app es.");
        byte[] bytes;
        try (InputStream input = new FileInputStream(info)) {
            bytes = new byte[(int) info.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
        }
        long required = new JSONObject(new String(bytes, StandardCharsets.UTF_8)).optLong("androidVersionCode", -1);
        if (required != installed) {
            throw new IOException("El paquete es para la app " + required + " y está instalada la " + installed + ".");
        }
    }

    private void copyCapacitorSyncFiles(File target) throws IOException {
        AssetManager assets = getContext().getAssets();
        for (String name : CAPACITOR_SYNC_FILES) {
            File out = new File(target, name);
            if (!out.exists()) copyAsset(assets, Bridge.DEFAULT_WEB_ASSET_DIR + "/" + name, out);
        }
    }

    private static void copyAsset(AssetManager assets, String assetPath, File out) throws IOException {
        String[] children = assets.list(assetPath);
        if (children != null && children.length > 0) {
            if (!out.isDirectory() && !out.mkdirs()) throw new IOException("No se pudo crear " + out);
            for (String child : children) copyAsset(assets, assetPath + "/" + child, new File(out, child));
            return;
        }
        try (InputStream input = assets.open(assetPath); OutputStream output = new FileOutputStream(out)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        } catch (java.io.FileNotFoundException missing) {
            // Not every build has Cordova plugins; nothing to copy.
        }
    }
}
