package com.yorureader.app;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native book reader for Android: the OpenReadEra EraEPUB engine (GPL-2.0, see EraEngine) renders
 * the book exported by the web UI (frontend/utils/nativeReader.ts) into page bitmaps, and
 * NativeReaderView shows and slides them above the WebView, which keeps Yoru's own bars and panels
 * (they show through the view's holes). Positions are xpaths of the engine's document; every block
 * of the exported book is a body-level &lt;p&gt;, so "/p[n]" is the n-th block ("ordinal").
 *
 * Threads: view state on the main thread, engine and page cache on the "native-reader" thread,
 * book files on the plugin's call thread.
 */
@CapacitorPlugin(name = "NativeReader")
public class NativeReaderPlugin extends Plugin implements NativeReaderView.Listener {
    private static final String TAG = "YoruNativeReader";
    private static final String ENGINE_BINARY = "liberaepub.so";
    private static final int KEEP_BOOKS = 4;
    private static final Pattern BLOCK_IN_XPATH = Pattern.compile("/body/p(?:\\[(\\d+)\\])?(?=/|$)");
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,120}");

    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread engineThread;
    private Handler engineHandler;

    // Main thread.
    private NativeReaderView view;
    private int viewWidth, viewHeight;
    private int pageCount = 0, current = 0;
    private Runnable pendingOpen;
    /** Bumped on every open and close: work queued for an older book is dropped. */
    private volatile int generation = 0;

    // Engine thread.
    private final EraEngine engine = new EraEngine();
    private final Map<Integer, Bitmap> cache = new HashMap<>();
    private Config config;
    private int enginePages = 0;
    private String bodyPrefix = null;
    private static List<String[]> japaneseFonts;  // [path, face], found once per process

    /** Reader settings sent by the web UI, already in CSS px / percent / RGB. */
    private static final class Config {
        boolean vertical;
        float fontSize, lineHeight, verticalPadding, horizontalPadding;
        int textColor, backgroundColor;
        String fontFamily, textAlign;
        boolean invertTaps;
        int width, height;           // view size in px
        Insets insets = Insets.NONE;  // system bars and cutout, px
        float density;

        static Config from(JSObject s, Config base) {
            Config c = new Config();
            c.vertical = s.optBoolean("vertical", base == null || base.vertical);
            c.fontSize = (float) s.optDouble("fontSize", base != null ? base.fontSize : 20);
            c.lineHeight = (float) s.optDouble("lineHeight", base != null ? base.lineHeight : 1.8);
            c.verticalPadding = (float) s.optDouble("verticalPadding", base != null ? base.verticalPadding : 3);
            c.horizontalPadding = (float) s.optDouble("horizontalPadding", base != null ? base.horizontalPadding : 8);
            c.textColor = s.optInt("textColor", base != null ? base.textColor : 0xE8E8F0) & 0xFFFFFF;
            c.backgroundColor = s.optInt("backgroundColor", base != null ? base.backgroundColor : 0x0C0E13) & 0xFFFFFF;
            c.fontFamily = s.optString("fontFamily", base != null ? base.fontFamily : "");
            c.textAlign = s.optString("textAlign", base != null ? base.textAlign : "original");
            c.invertTaps = s.optBoolean("invertTaps", base != null && base.invertTaps);
            return c;
        }
    }

    @Override
    public void load() {
        engineThread = new HandlerThread("native-reader");
        engineThread.start();
        engineHandler = new Handler(engineThread.getLooper());
    }

    @Override
    protected void handleOnDestroy() {
        generation++;
        engineHandler.post(() -> {
            engine.stop();
            cache.clear();
        });
        engineThread.quitSafely();
    }

    private File booksDir() {
        return new File(getContext().getFilesDir(), "native-reader");
    }

    private File bookDir(String key) {
        return new File(booksDir(), key);
    }

    // ---- Book files ----

    @PluginMethod
    public void hasBook(PluginCall call) {
        String key = call.getString("key", "");
        JSObject result = new JSObject();
        result.put("exists", SAFE_NAME.matcher(key).matches() && new File(bookDir(key), "book.html").isFile());
        call.resolve(result);
    }

    /** Appends a piece of the exported HTML; the book is complete (and openable) after the last one. */
    @PluginMethod
    public void writeBookChunk(PluginCall call) {
        String key = call.getString("key", "");
        String data = call.getString("data", "");
        boolean first = Boolean.TRUE.equals(call.getBoolean("first", false));
        boolean last = Boolean.TRUE.equals(call.getBoolean("last", false));
        if (!SAFE_NAME.matcher(key).matches()) {
            call.reject("BAD_KEY");
            return;
        }
        File dir = bookDir(key);
        File partial = new File(dir, "book.html.part");
        try {
            if (first) {
                deleteRecursively(dir);
                if (!dir.mkdirs()) throw new IOException("mkdirs " + dir);
            }
            try (Writer writer = new OutputStreamWriter(new FileOutputStream(partial, !first), StandardCharsets.UTF_8)) {
                writer.write(data);
            }
            if (last) {
                if (!partial.renameTo(new File(dir, "book.html"))) throw new IOException("rename");
                pruneOldBooks(key);
            }
            call.resolve();
        } catch (IOException e) {
            Log.e(TAG, "writeBookChunk", e);
            call.reject("WRITE_FAILED", e);
        }
    }

    /** Writes an image of the book (base64) next to its HTML, as img/&lt;name&gt;. */
    @PluginMethod
    public void writeBookImage(PluginCall call) {
        String key = call.getString("key", "");
        String name = call.getString("name", "");
        if (!SAFE_NAME.matcher(key).matches() || !SAFE_NAME.matcher(name).matches()) {
            call.reject("BAD_NAME");
            return;
        }
        File dir = new File(bookDir(key), "img");
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("mkdirs " + dir);
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
                out.write(bytes);
            }
            call.resolve();
        } catch (IllegalArgumentException | IOException e) {
            call.reject("WRITE_FAILED", e);
        }
    }

    private void pruneOldBooks(String keep) {
        File[] dirs = booksDir().listFiles(File::isDirectory);
        if (dirs == null || dirs.length <= KEEP_BOOKS) return;
        Arrays.sort(dirs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = KEEP_BOOKS; i < dirs.length; i++) {
            if (!dirs[i].getName().equals(keep)) deleteRecursively(dirs[i]);
        }
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }

    // ---- Reading ----

    /**
     * Shows the reader and opens a book written with writeBookChunk. Options: key, settings,
     * xpath (exact saved position) or ordinal (block to start at). Resolves with
     * { pages, page, ordinal, xpath } once the first page is on screen.
     */
    @PluginMethod
    public void open(PluginCall call) {
        String key = call.getString("key", "");
        File book = new File(bookDir(key), "book.html");
        if (!SAFE_NAME.matcher(key).matches() || !book.isFile()) {
            call.reject("NO_BOOK");
            return;
        }
        File binary = new File(getContext().getApplicationInfo().nativeLibraryDir, ENGINE_BINARY);
        if (!binary.isFile()) {
            call.reject("NO_ENGINE");
            return;
        }
        book.getParentFile().setLastModified(System.currentTimeMillis());
        JSObject settings = call.getObject("settings", new JSObject());
        String xpath = call.getString("xpath", "");
        int ordinal = call.getInt("ordinal", -1);
        main.post(() -> {
            final int gen = ++generation;
            ensureView();
            Config base = Config.from(settings, null);
            view.setLook(0xFF000000 | base.backgroundColor, base.vertical, base.invertTaps);
            view.setPages(null, null, null);
            view.setHoles(new ArrayList<>());
            view.setVisibility(View.VISIBLE);
            pageCount = 0;
            current = 0;
            pendingOpen = () -> {
                Config c = withScreen(base);
                engineHandler.post(() -> openOnEngine(gen, call, binary, book, c, xpath, ordinal));
            };
            if (viewWidth > 0 && viewHeight > 0 && view.getWidth() == viewWidth) runPendingOpen();
        });
    }

    private void runPendingOpen() {
        Runnable open = pendingOpen;
        pendingOpen = null;
        if (open != null) open.run();
    }

    private void ensureView() {
        if (view != null) return;
        WebView webView = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) webView.getParent();
        view = new NativeReaderView(getContext(), this);
        view.setVisibility(View.GONE);
        parent.addView(view, parent.indexOfChild(webView) + 1,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Adds the view size, density and system insets (main thread). */
    private Config withScreen(Config c) {
        c.width = viewWidth;
        c.height = viewHeight;
        c.density = getContext().getResources().getDisplayMetrics().density;
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
        if (insets != null) {
            c.insets = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        }
        return c;
    }

    private void openOnEngine(int gen, PluginCall call, File binary, File book, Config c, String xpath, int ordinal) {
        if (gen != generation) {
            call.reject("CANCELLED");
            return;
        }
        try {
            long t0 = SystemClock.elapsedRealtime();
            engine.stop();
            cache.clear();
            bodyPrefix = null;
            engine.start(binary, getContext().getFilesDir());
            registerFonts();
            config = c;
            engine.request(EraEngine.CMD_REQ_SET_CONFIG, layoutConfig(c, false));
            List<EraEngine.Item> open = new ArrayList<>();
            open.add(EraEngine.Item.str(""));            // no socket: open by path
            open.add(new EraEngine.Item(EraEngine.DOC_FORMAT_HTML));
            open.add(EraEngine.Item.str(book.getAbsolutePath()));
            open.add(new EraEngine.Item(0));             // not an archive
            EraEngine.Response opened = engine.request(EraEngine.CMD_REQ_OPEN, open);
            if (opened.result != 0 || opened.items.isEmpty()) throw new IOException("open result " + opened.result);
            // Settings that need the document (text alignment, indents, the book's own CSS).
            EraEngine.Response configured = engine.request(EraEngine.CMD_REQ_SET_CONFIG, layoutConfig(c, true));
            enginePages = configured.intAt(0, opened.intAt(0, 0));
            String firstXPath = pageXPath(0);
            int slash = firstXPath.lastIndexOf("/body");
            bodyPrefix = slash >= 0 ? firstXPath.substring(0, slash + 5) : null;

            int page = 0;
            if (xpath != null && !xpath.isEmpty()) page = pageByXPath(xpath, 0);
            else if (ordinal > 0 && bodyPrefix != null) page = pageByXPath(bodyPrefix + "/p[" + (ordinal + 1) + "]", 0);
            final int startPage = clampPage(page);
            renderAround(gen, startPage);
            String startXPath = pageXPath(startPage);
            Log.i(TAG, "opened " + enginePages + " pages in " + (SystemClock.elapsedRealtime() - t0) + " ms, prefix " + bodyPrefix + ", start " + startXPath);
            final int pages = enginePages;
            main.post(() -> {
                if (gen != generation) return;
                pageCount = pages;
                current = startPage;
                publish();
                call.resolve(positionResult(startPage, pages, startXPath));
            });
        } catch (Throwable e) {
            Log.e(TAG, "open failed", e);
            String log = engine.logTail();
            engine.stop();
            call.reject("OPEN_FAILED: " + e.getMessage() + (log.isEmpty() ? "" : "\n" + log));
        }
    }

    private JSObject positionResult(int page, int pages, String xpath) {
        JSObject result = new JSObject();
        result.put("page", page);
        result.put("pages", pages);
        result.put("xpath", xpath);
        result.put("ordinal", ordinalOf(xpath));
        return result;
    }

    /** Block index of an engine xpath ("/body/p[n]/..." is block n - 1), or -1. */
    private static int ordinalOf(String xpath) {
        if (xpath == null) return -1;
        Matcher m = BLOCK_IN_XPATH.matcher(xpath);
        if (!m.find()) return -1;
        return m.group(1) != null ? Integer.parseInt(m.group(1)) - 1 : 0;
    }

    private int clampPage(int page) {
        return Math.max(0, Math.min(page, Math.max(0, enginePages - 1)));
    }

    private String pageXPath(int page) throws IOException {
        List<EraEngine.Item> req = new ArrayList<>();
        req.add(new EraEngine.Item(page));
        EraEngine.Response r = engine.request(EraEngine.CMD_REQ_CRE_PAGE_XPATH, req);
        return r.result == 0 ? r.stringAt(0) : "";
    }

    private int pageByXPath(String xpath, int fallback) throws IOException {
        List<EraEngine.Item> req = new ArrayList<>();
        req.add(EraEngine.Item.str(xpath));
        EraEngine.Response r = engine.request(EraEngine.CMD_REQ_CRE_PAGE_BY_XPATH, req);
        return r.result == 0 ? r.intAt(0, fallback) : fallback;
    }

    /** System Japanese fonts (Noto Serif/Sans CJK JP on most phones). The scan is done once. */
    private void registerFonts() throws IOException {
        if (japaneseFonts == null) {
            List<String[]> found = new ArrayList<>();
            List<EraEngine.Item> dir = new ArrayList<>();
            dir.add(EraEngine.Item.str("/system/fonts"));
            EraEngine.Response names = engine.request(EraEngine.CMD_REQ_FONT_NAMES, dir);
            for (EraEngine.Item item : names.items) {
                // "path;face;index;flags;languages"
                String[] fields = item.asString().split(";");
                if (fields.length >= 2 && fields[1].endsWith("CJK JP")) found.add(new String[] { fields[0], fields[1] });
            }
            japaneseFonts = found;
        }
        List<EraEngine.Item> fonts = new ArrayList<>();
        List<String> paths = new ArrayList<>();
        for (String[] font : japaneseFonts) if (!paths.contains(font[0])) paths.add(font[0]);
        File cjk = new File("/system/fonts/NotoSansCJK-Regular.ttc");
        if (cjk.exists() && !paths.contains(cjk.getAbsolutePath())) paths.add(cjk.getAbsolutePath());
        for (int i = 0; i < paths.size(); i++) {
            fonts.add(new EraEngine.Item(i));
            fonts.add(EraEngine.Item.str(paths.get(i)));
        }
        if (!fonts.isEmpty()) engine.request(EraEngine.CMD_REQ_SET_FONT_CONFIG, fonts);
    }

    private static String fontFace(String family) {
        boolean sans = family != null && family.toLowerCase(Locale.ROOT).contains("sans");
        String fallback = null;
        if (japaneseFonts != null) {
            for (String[] font : japaneseFonts) {
                String face = font[1];
                boolean faceSans = face.toLowerCase(Locale.ROOT).contains("sans");
                if (faceSans == sans && face.startsWith("Noto")) return face;
                if (fallback == null) fallback = face;
            }
        }
        return fallback != null ? fallback : (sans ? "Noto Sans CJK JP" : "Noto Serif CJK JP");
    }

    private static void addConfig(List<EraEngine.Item> config, int key, String value) {
        config.add(new EraEngine.Item(key));
        config.add(EraEngine.Item.str(value));
    }

    /**
     * Engine settings from the reader settings. Margins follow the WebView reader (padding in
     * percent of the screen, at least 10 CSS px) plus the system bars. In vertical mode the engine
     * lays the page out on its side and rotates it a quarter turn clockwise: its left margin ends up
     * at the top of the screen, its top margin on the right.
     */
    private static List<EraEngine.Item> layoutConfig(Config c, boolean withDocument) {
        List<EraEngine.Item> config = new ArrayList<>();
        int minMargin = Math.round(10 * c.density);
        int vp = Math.max(minMargin, Math.round(c.height * c.verticalPadding / 100f));
        int hp = Math.max(minMargin, Math.round(c.width * c.horizontalPadding / 100f));
        int top = vp + c.insets.top, bottom = vp + c.insets.bottom;
        int left = hp + c.insets.left, right = hp + c.insets.right;
        Log.i(TAG, String.format(Locale.US, "layout %dx%d density %.2f font %.0f line %.2f padding %.1f%%/%.1f%% -> margins t%d b%d l%d r%d",
            c.width, c.height, c.density, c.fontSize, c.lineHeight, c.verticalPadding, c.horizontalPadding, top, bottom, left, right));
        addConfig(config, EraEngine.CONFIG_VERTICAL_MODE, c.vertical ? "1" : "0");
        addConfig(config, EraEngine.CONFIG_PAGE_WIDTH, String.valueOf(c.vertical ? c.height : c.width));
        addConfig(config, EraEngine.CONFIG_PAGE_HEIGHT, String.valueOf(c.vertical ? c.width : c.height));
        addConfig(config, EraEngine.CONFIG_FONT_FACE_MAIN, fontFace(c.fontFamily));
        addConfig(config, EraEngine.CONFIG_FONT_SIZE, String.valueOf(Math.round(c.fontSize * c.density)));
        // The engine's 100 is the font's own line height (about 1.2 em in CSS terms).
        int interline = Math.max(70, Math.min(200, Math.round(c.lineHeight / 1.2f * 100)));
        addConfig(config, EraEngine.CONFIG_INTERLINE, String.valueOf(interline));
        addConfig(config, EraEngine.CONFIG_FONT_COLOR, String.valueOf(c.textColor));
        addConfig(config, EraEngine.CONFIG_BACKGROUND_COLOR, String.valueOf(c.backgroundColor));
        addConfig(config, EraEngine.CONFIG_MARGIN_TOP, String.valueOf(c.vertical ? right : top));
        addConfig(config, EraEngine.CONFIG_MARGIN_BOTTOM, String.valueOf(c.vertical ? left : bottom));
        addConfig(config, EraEngine.CONFIG_MARGIN_LEFT, String.valueOf(c.vertical ? top : left));
        addConfig(config, EraEngine.CONFIG_MARGIN_RIGHT, String.valueOf(c.vertical ? bottom : right));
        if (withDocument) {
            addConfig(config, EraEngine.CONFIG_EMBEDDED_STYLES, "1");
            int align;
            switch (c.textAlign == null ? "" : c.textAlign) {
                case "justify": align = 0; break;
                case "center": align = 2; break;
                case "right": align = 3; break;
                default: align = 1;
            }
            addConfig(config, EraEngine.CONFIG_TEXT_ALIGN, String.valueOf(align));
            addConfig(config, EraEngine.CONFIG_TEXT_INDENT, "0");
            addConfig(config, EraEngine.CONFIG_PARAGRAPH_MARGIN, "0");
            addConfig(config, EraEngine.CONFIG_HYPHENATION, "0");
        }
        return config;
    }

    /** Renders the page and its neighbours (engine thread), then hands them to the view. */
    private void renderAround(int gen, int page) {
        Config c = config;
        if (c == null) return;
        for (int p : new int[] { page, page + 1, page - 1, page + 2 }) {
            if (gen != generation) return;
            if (p < 0 || p >= enginePages) continue;
            synchronized (cache) {
                if (cache.containsKey(p)) continue;
            }
            try {
                byte[] pixels = engine.renderPage(p, c.width, c.height);
                if (pixels == null) continue;
                Bitmap bitmap = Bitmap.createBitmap(c.width, c.height, Bitmap.Config.ARGB_8888);
                bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(pixels));
                bitmap.prepareToDraw();
                synchronized (cache) {
                    cache.put(p, bitmap);
                }
            } catch (IOException e) {
                engineFailed(gen, e);
                return;
            }
            // The page on screen first, then the rest.
            if (p == page) main.post(() -> { if (gen == generation) publish(); });
        }
        synchronized (cache) {
            cache.keySet().removeIf(p -> p < page - 2 || p > page + 3);
        }
        main.post(() -> { if (gen == generation) publish(); });
    }

    private void engineFailed(int gen, Throwable e) {
        Log.e(TAG, "engine failed", e);
        String log = engine.logTail();
        engine.stop();
        if (gen != generation) return;
        JSObject event = new JSObject();
        event.put("message", e.getMessage() + (log.isEmpty() ? "" : "\n" + log));
        notifyListeners("error", event);
    }

    private void publish() {
        if (view == null) return;
        Bitmap prev, cur, next;
        synchronized (cache) {
            prev = cache.get(current - 1);
            cur = cache.get(current);
            next = cache.get(current + 1);
        }
        view.setPages(prev, cur, next);
    }

    /** After a turn or jump: renders around the page and reports the new position. */
    private void showPage(int gen, int page) {
        renderAround(gen, page);
        try {
            String xpath = pageXPath(page);
            if (gen != generation) return;
            notifyListeners("pageChanged", positionResult(page, enginePages, xpath));
        } catch (IOException e) {
            engineFailed(gen, e);
        }
    }

    @Override
    public void onSized(int width, int height) {
        boolean changed = viewWidth != 0 && (viewWidth != width || viewHeight != height);
        viewWidth = width;
        viewHeight = height;
        if (pendingOpen != null) runPendingOpen();
        else if (changed && config != null) applySettings(new JSObject(), null);
    }

    @Override
    public boolean canTurn(int direction) {
        int target = current + direction;
        return pageCount > 0 && target >= 0 && target < pageCount;
    }

    @Override
    public void onTurned(int direction) {
        current = Math.max(0, Math.min(pageCount - 1, current + direction));
        publish();
        final int gen = generation, page = current;
        engineHandler.post(() -> showPage(gen, page));
    }

    @Override
    public void onCenterTap(float x, float y) {
        float density = getContext().getResources().getDisplayMetrics().density;
        JSObject event = new JSObject();
        event.put("x", x / density);
        event.put("y", y / density);
        notifyListeners("tap", event);
    }

    /** New reader settings (any subset): the layout is redone and the current position kept. */
    @PluginMethod
    public void setSettings(PluginCall call) {
        JSObject settings = call.getObject("settings", new JSObject());
        main.post(() -> applySettings(settings, call));
    }

    private void applySettings(JSObject settings, PluginCall call) {
        if (view == null || config == null) {
            if (call != null) call.resolve();
            return;
        }
        Config next = withScreen(Config.from(settings, config));
        view.setLook(0xFF000000 | next.backgroundColor, next.vertical, next.invertTaps);
        final int gen = generation, page = current;
        engineHandler.post(() -> {
            if (gen != generation) return;
            try {
                String xpath = pageXPath(page);
                config = next;
                EraEngine.Response r = engine.request(EraEngine.CMD_REQ_SET_CONFIG, layoutConfig(next, true));
                enginePages = r.intAt(0, enginePages);
                int target = clampPage(xpath.isEmpty() ? page : pageByXPath(xpath, page));
                synchronized (cache) {
                    cache.clear();
                }
                final int pages = enginePages;
                main.post(() -> {
                    if (gen != generation) return;
                    pageCount = pages;
                    current = target;
                });
                showPage(gen, target);
                if (call != null) call.resolve();
            } catch (IOException e) {
                engineFailed(gen, e);
                if (call != null) call.reject("ENGINE_FAILED");
            }
        });
    }

    /** Jumps to a block (ordinal) or page. */
    @PluginMethod
    public void goTo(PluginCall call) {
        int ordinal = call.getInt("ordinal", -1);
        int page = call.getInt("page", -1);
        final int gen = generation;
        engineHandler.post(() -> {
            if (gen != generation || config == null) {
                call.reject("NOT_OPEN");
                return;
            }
            try {
                int target = page;
                if (ordinal >= 0 && bodyPrefix != null) target = pageByXPath(bodyPrefix + "/p[" + (ordinal + 1) + "]", current);
                final int to = clampPage(target);
                main.post(() -> {
                    if (gen != generation) return;
                    current = to;
                    publish();
                });
                showPage(gen, to);
                call.resolve();
            } catch (IOException e) {
                engineFailed(gen, e);
                call.reject("ENGINE_FAILED");
            }
        });
    }

    /** Turns one page with the slide (1 = next, -1 = previous), as a tap on the page edge would. */
    @PluginMethod
    public void turnPage(PluginCall call) {
        int direction = call.getInt("direction", 1) >= 0 ? 1 : -1;
        main.post(() -> {
            if (view != null && view.getVisibility() == View.VISIBLE) view.turn(direction);
            call.resolve();
        });
    }

    /**
     * Screen areas (CSS px rectangles [left, top, right, bottom]) where the WebView shows through
     * and gets the touches: Yoru's bars, popovers and panels while they are open.
     */
    @PluginMethod
    public void setHoles(PluginCall call) {
        JSArray rects = call.getArray("rects", new JSArray());
        float density = getContext().getResources().getDisplayMetrics().density;
        List<Rect> holes = new ArrayList<>();
        try {
            for (int i = 0; i < rects.length(); i++) {
                JSONArray r = rects.getJSONArray(i);
                holes.add(new Rect(
                    (int) Math.floor(r.getDouble(0) * density), (int) Math.floor(r.getDouble(1) * density),
                    (int) Math.ceil(r.getDouble(2) * density), (int) Math.ceil(r.getDouble(3) * density)));
            }
        } catch (Exception e) {
            call.reject("BAD_RECTS");
            return;
        }
        main.post(() -> {
            if (view != null) view.setHoles(holes);
            call.resolve();
        });
    }

    /** Hides the reader and stops the engine. */
    @PluginMethod
    public void close(PluginCall call) {
        main.post(() -> {
            generation++;
            pendingOpen = null;
            pageCount = 0;
            current = 0;
            if (view != null) {
                view.setPages(null, null, null);
                view.setVisibility(View.GONE);
            }
            engineHandler.post(() -> {
                engine.stop();
                config = null;
                synchronized (cache) {
                    cache.clear();
                }
            });
            call.resolve();
        });
    }
}
