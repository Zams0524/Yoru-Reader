package com.yorureader.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
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

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

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
    private static final String BOOK_FILE = "book.epub";
    private static final String PICTURES_FILE = "pictures.idx";
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
    /** The web UI shows the dictionary popup: a tap on the page only closes it. */
    private boolean popupOpen = false;
    /** Bumped on every open and close: work queued for an older book is dropped. */
    private volatile int generation = 0;

    // Engine thread.
    private final EraEngine engine = new EraEngine();
    private final Map<Integer, Bitmap> cache = new HashMap<>();
    private Config config;
    private int enginePages = 0;
    private String bodyPrefix = null;
    /** Blocks that are only a picture (ordinal -> image file): their pages are drawn here, not by the engine. */
    private Map<Integer, File> pictures = new HashMap<>();
    private static List<String[]> japaneseFonts;  // [path, face], found once per process
    /** Letters of the page on screen (written on the engine thread, read on the main thread). */
    private volatile PageLetters letters;

    /** Letter boxes of one page in view px (left, top, right, bottom), in the engine's hitbox order. */
    private static final class PageLetters {
        final int page;
        final float[] boxes;
        final String[] texts;
        PageLetters(int page, float[] boxes, String[] texts) {
            this.page = page;
            this.boxes = boxes;
            this.texts = texts;
        }
    }

    /** Reader settings sent by the web UI, already in CSS px / percent / RGB. */
    private static final class Config {
        boolean vertical;
        float fontSize, lineHeight, verticalPadding, horizontalPadding;
        int textColor, backgroundColor;
        String fontFamily, textAlign;
        boolean invertTaps;
        boolean kindleTaps;
        int brightness;               // 0-100, below 100 the page is dimmed
        List<Underline> underlines = new ArrayList<>();
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
            c.kindleTaps = "kindle".equals(s.optString("tapZoneMode", base != null && base.kindleTaps ? "kindle" : "edge"));
            c.brightness = Math.max(0, Math.min(100, s.optInt("brightness", base != null ? base.brightness : 100)));
            JSONArray lines = s.optJSONArray("underlines");
            if (lines == null) {
                if (base != null) c.underlines = base.underlines;
            } else {
                for (int i = 0; i < lines.length(); i++) {
                    org.json.JSONObject line = lines.optJSONObject(i);
                    if (line == null) continue;
                    c.underlines.add(new Underline(line.optInt("background"), line.optInt("color"),
                        (float) line.optDouble("thickness", 2), line.optString("style", "solid")));
                }
            }
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
            pageLetters.clear();
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
        result.put("exists", SAFE_NAME.matcher(key).matches() && new File(bookDir(key), BOOK_FILE).isFile());
        call.resolve(result);
    }

    /**
     * Appends a piece of the exported XHTML; after the last one the book is packed as an EPUB (the
     * engine only opens image files for documents in a container, not for a plain HTML file).
     */
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
        File partial = new File(dir, "book.xhtml.part");
        try {
            JSArray reused = new JSArray();
            if (first) {
                deleteRecursively(dir);
                if (!dir.mkdirs()) throw new IOException("mkdirs " + dir);
                JSObject images = call.getObject("images", null);
                if (images != null) for (String name : reuseImages(key, images)) reused.put(name);
            }
            try (Writer writer = new OutputStreamWriter(new FileOutputStream(partial, !first), StandardCharsets.UTF_8)) {
                writer.write(data);
            }
            if (last) {
                packEpub(dir, partial);
                pruneOldBooks(key);
            }
            JSObject result = new JSObject();
            result.put("reused", reused);
            call.resolve(result);
        } catch (IOException e) {
            Log.e(TAG, "writeBookChunk", e);
            call.reject("WRITE_FAILED", e);
        }
    }

    /**
     * Copies into the new export the images ({name: bytes}) that an earlier export of the same book
     * already has with the same size, so a reload (new word states) does not send them again
     * through the bridge. Returns the names copied.
     */
    private List<String> reuseImages(String key, JSObject images) {
        List<String> copied = new ArrayList<>();
        String prefix = sameBookPrefix(key);
        File[] older = prefix == null ? null
            : booksDir().listFiles((d, name) -> name.startsWith(prefix) && !name.equals(key) && new File(new File(d, name), "img").isDirectory());
        if (older == null || older.length == 0) return copied;
        File source = new File(older[0], "img");
        File target = new File(bookDir(key), "img");
        Iterator<String> names = images.keys();
        while (names.hasNext()) {
            String name = names.next();
            File from = new File(source, name);
            if (!SAFE_NAME.matcher(name).matches() || !from.isFile() || from.length() != images.optLong(name, -1)) continue;
            try {
                if (!target.isDirectory() && !target.mkdirs()) break;
                try (FileOutputStream out = new FileOutputStream(new File(target, name))) {
                    copy(from, out);
                }
                copied.add(name);
            } catch (IOException e) {
                Log.w(TAG, "reuse image " + name, e);
            }
        }
        return copied;
    }

    /** "<id>-" of an export key "<id>-<hash>-v<version>", or null. */
    private static String sameBookPrefix(String key) {
        int versionDash = key.lastIndexOf('-');
        int hashDash = versionDash > 0 ? key.lastIndexOf('-', versionDash - 1) : -1;
        return hashDash > 0 ? key.substring(0, hashDash + 1) : null;
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

    /** book.epub = the XHTML and img/ in a minimal EPUB; the loose files are removed. */
    /**
     * book.epub = the XHTML and its images in a minimal EPUB; pictures.idx lists the blocks that
     * are only a picture. In the EPUB those pictures are replaced by a placeholder taller than any
     * page: the engine then gives each one a page of its own (it does not always honour
     * page-break-* between two images), and drawPicturePage draws the real picture there. img/ stays.
     */
    private static void packEpub(File dir, File xhtml) throws IOException {
        File images = new File(dir, "img");
        StringBuilder book = new StringBuilder();
        java.util.Set<String> used = new java.util.TreeSet<>();
        String css = "";
        try (BufferedReader lines = new BufferedReader(new FileReader(xhtml)); FileWriter index = new FileWriter(new File(dir, PICTURES_FILE))) {
            int ordinal = 0;
            String line;
            while ((line = lines.readLine()) != null) {
                if (line.startsWith("<p")) {
                    Matcher picture = PICTURE_BLOCK.matcher(line);
                    if (picture.matches() && isSmallImage(new File(images, picture.group(1)))) {
                        // A logo or ornament stays in the text, as ReadEra shows it (no page of its own).
                        line = line.replaceFirst("\\bi\\b", "si");
                    } else if (picture.matches()) {
                        index.write(ordinal + "\t" + picture.group(1) + "\n");
                        line = line.replace("img/" + picture.group(1), "img/" + PAGE_PLACEHOLDER);
                    }
                    ordinal++;
                }
                // The book CSS goes in style.css, a stylesheet of the EPUB, where the engine reads it.
                int styleStart = line.indexOf("<style>"), styleEnd = line.indexOf("</style>");
                if (styleStart >= 0 && styleEnd > styleStart) {
                    css = line.substring(styleStart + 7, styleEnd);
                    line = line.substring(0, styleStart) + "<link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/>" + line.substring(styleEnd + 8);
                }
                Matcher image = IMAGE_REF.matcher(line);
                while (image.find()) used.add(image.group(1));
                book.append(line).append('\n');
            }
        }
        used.remove(PAGE_PLACEHOLDER);
        StringBuilder manifest = new StringBuilder("<item id=\"book\" href=\"book.xhtml\" media-type=\"application/xhtml+xml\"/>");
        manifest.append("<item id=\"css\" href=\"style.css\" media-type=\"text/css\"/>");
        manifest.append("<item id=\"page\" href=\"img/").append(PAGE_PLACEHOLDER).append("\" media-type=\"image/png\"/>");
        int n = 0;
        for (String name : used) {
            String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            String type = ext.equals("jpg") ? "image/jpeg" : ext.equals("svg") ? "image/svg+xml" : "image/" + ext;
            manifest.append("<item id=\"img").append(n++).append("\" href=\"img/").append(name).append("\" media-type=\"").append(type).append("\"/>");
        }
        String opf = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"2.0\" unique-identifier=\"id\">"
            + "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>Yoru</dc:title><dc:language>ja</dc:language>"
            + "<dc:identifier id=\"id\">" + dir.getName() + "</dc:identifier></metadata>"
            + "<manifest>" + manifest + "</manifest><spine><itemref idref=\"book\"/></spine></package>";
        String container = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">"
            + "<rootfiles><rootfile full-path=\"content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>";
        File partial = new File(dir, BOOK_FILE + ".part");
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(partial))) {
            putStored(zip, "mimetype", "application/epub+zip".getBytes(StandardCharsets.US_ASCII));
            putDeflated(zip, "META-INF/container.xml", container.getBytes(StandardCharsets.UTF_8));
            putDeflated(zip, "content.opf", opf.getBytes(StandardCharsets.UTF_8));
            putDeflated(zip, "book.xhtml", book.toString().getBytes(StandardCharsets.UTF_8));
            putDeflated(zip, "style.css", css.getBytes(StandardCharsets.UTF_8));
            putStored(zip, "img/" + PAGE_PLACEHOLDER, pagePlaceholder());
            // Images inside the text; already compressed: store them.
            for (String name : used) {
                File image = new File(images, name);
                if (!image.isFile()) continue;
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream((int) image.length());
                copy(image, bytes);
                putStored(zip, "img/" + name, bytes.toByteArray());
            }
        }
        if (!partial.renameTo(new File(dir, BOOK_FILE))) throw new IOException("rename");
        xhtml.delete();
    }

    private static final String PAGE_PLACEHOLDER = "_yoru_page.png";

    /** Under 400 px on both sides: a logo or ornament rather than an illustration. */
    private static boolean isSmallImage(File image) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(image.getAbsolutePath(), bounds);
        return bounds.outWidth > 0 && bounds.outWidth < 400 && bounds.outHeight < 400;
    }
    private static final Pattern IMAGE_REF = Pattern.compile("src=\"img/([A-Za-z0-9._-]+)\"");

    /** A transparent PNG much taller than a page: the engine scales it to fill one page. */
    private static byte[] pagePlaceholder() {
        Bitmap bitmap = Bitmap.createBitmap(4, 6000, Bitmap.Config.ARGB_8888);
        java.io.ByteArrayOutputStream png = new java.io.ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
        bitmap.recycle();
        return png.toByteArray();
    }

    private static final Pattern PICTURE_BLOCK = Pattern.compile("^<p class=\"(?:[^\"]* )?i(?: [^\"]*)?\"><img src=\"img/([A-Za-z0-9._-]+)\"/></p>$");

    private static Map<Integer, File> loadPictures(File dir) {
        Map<Integer, File> pictures = new HashMap<>();
        File index = new File(dir, PICTURES_FILE);
        if (!index.isFile()) return pictures;
        try (BufferedReader lines = new BufferedReader(new FileReader(index))) {
            String line;
            while ((line = lines.readLine()) != null) {
                int tab = line.indexOf('\t');
                if (tab > 0) pictures.put(Integer.parseInt(line.substring(0, tab)), new File(new File(dir, "img"), line.substring(tab + 1)));
            }
        } catch (IOException | NumberFormatException e) {
            Log.w(TAG, "pictures index", e);
        }
        return pictures;
    }

    private static void putStored(ZipOutputStream zip, String name, byte[] data) throws IOException {
        ZipEntry entry = new ZipEntry(name);
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(data.length);
        entry.setCompressedSize(data.length);
        CRC32 crc = new CRC32();
        crc.update(data);
        entry.setCrc(crc.getValue());
        zip.putNextEntry(entry);
        zip.write(data);
        zip.closeEntry();
    }

    private static void putDeflated(ZipOutputStream zip, String name, byte[] data) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(data);
        zip.closeEntry();
    }

    private static void copy(File from, java.io.OutputStream to) throws IOException {
        try (FileInputStream in = new FileInputStream(from)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) to.write(buffer, 0, n);
        }
    }

    private void pruneOldBooks(String keep) {
        // Earlier exports of the same book ("<id>-<hash>-v<version>"): replaced by this one.
        String sameBook = sameBookPrefix(keep);
        if (sameBook != null) {
            File[] older = booksDir().listFiles((dir, name) -> name.startsWith(sameBook) && !name.equals(keep));
            if (older != null) for (File dir : older) deleteRecursively(dir);
        }
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
        File book = new File(bookDir(key), BOOK_FILE);
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
        String innerPath = call.getString("innerPath", "");
        main.post(() -> {
            final int gen = ++generation;
            ensureView();
            Config base = Config.from(settings, null);
            view.setLook(0xFF000000 | base.backgroundColor, base.vertical, base.invertTaps, base.kindleTaps, base.brightness);
            // A reload (new word states) keeps the page, the holes and the popup state until the
            // new pages are ready; a fresh open starts blank.
            if (view.getVisibility() != View.VISIBLE) {
                view.setPages(null, null, null);
                view.setHoles(new ArrayList<>());
                popupOpen = false;
            }
            view.setVisibility(View.VISIBLE);
            pageCount = 0;
            current = 0;
            letters = null;
            pendingOpen = () -> {
                Config c = withScreen(base);
                engineHandler.post(() -> openOnEngine(gen, call, binary, book, c, xpath, ordinal, innerPath));
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

    private void openOnEngine(int gen, PluginCall call, File binary, File book, Config c, String xpath, int ordinal, String innerPath) {
        if (gen != generation) {
            call.reject("CANCELLED");
            return;
        }
        try {
            long t0 = SystemClock.elapsedRealtime();
            engine.stop();
            cache.clear();
            pageLetters.clear();
            bodyPrefix = null;
            pictures = loadPictures(book.getParentFile());
            engine.start(binary, getContext().getFilesDir());
            registerFonts();
            config = c;
            // All settings before OPEN, the document ones too (alignment, indents, the book's CSS):
            // they go to the engine's empty DOM, which OPEN fills, so the book is laid out once.
            // Sent after OPEN they cost a second layout of the whole book (about a second).
            engine.request(EraEngine.CMD_REQ_SET_CONFIG, layoutConfig(c, true));
            List<EraEngine.Item> open = new ArrayList<>();
            open.add(EraEngine.Item.str(""));            // no socket: open by path
            open.add(new EraEngine.Item(EraEngine.DOC_FORMAT_EPUB));
            open.add(EraEngine.Item.str(book.getAbsolutePath()));
            open.add(new EraEngine.Item(0));             // not an archive
            long tOpen = SystemClock.elapsedRealtime();
            EraEngine.Response opened = engine.request(EraEngine.CMD_REQ_OPEN, open);
            if (opened.result != 0 || opened.items.isEmpty()) throw new IOException("open result " + opened.result);
            enginePages = opened.intAt(0, 0);
            Log.i(TAG, "timing: start+fonts " + (tOpen - t0) + " ms, open " + (SystemClock.elapsedRealtime() - tOpen) + " ms");
            String firstXPath = pageXPath(0);
            int slash = firstXPath.lastIndexOf("/body");
            bodyPrefix = slash >= 0 ? firstXPath.substring(0, slash + 5) : null;

            int page = 0;
            // An exact place first; if the document's markup changed since it was saved (word
            // spans), the block it was in.
            int block = ordinal;
            page = -1;
            if (xpath != null && !xpath.isEmpty()) {
                page = pageByXPath(xpath, -1);
                if (page < 0) block = ordinalOf(xpath);
            } else if (block >= 0 && innerPath != null && !innerPath.isEmpty() && bodyPrefix != null) {
                page = pageByXPath(bodyPrefix + "/p[" + (block + 1) + "]/" + innerPath, -1);
            }
            if (page < 0 && block > 0 && bodyPrefix != null) page = pageByXPath(bodyPrefix + "/p[" + (block + 1) + "]", 0);
            if (page < 0) page = 0;
            final int startPage = clampPage(page);
            // Only the page on screen before answering; its neighbours right after.
            renderPages(gen, startPage, new int[] { startPage });
            loadLetters(gen, startPage);
            engineHandler.post(() -> renderAround(gen, startPage));
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
        // All of the book's CSS (level 5, unfiltered): word-state colours, picture pages, headings.
        addConfig(config, EraEngine.CONFIG_ERA_EMBEDDED_STYLES, "5");
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
        renderPages(gen, page, new int[] { page, page + 1, page - 1, page + 2 });
    }

    /** Renders the given pages (engine thread); page is the one on screen. */
    private void renderPages(int gen, int page, int[] pages) {
        Config c = config;
        if (c == null) return;
        for (int p : pages) {
            if (gen != generation) return;
            if (p < 0 || p >= enginePages) continue;
            synchronized (cache) {
                if (cache.containsKey(p)) continue;
            }
            try {
                Bitmap bitmap = drawPicturePage(p, c);
                if (bitmap == null) {
                    byte[] pixels = engine.renderPage(p, c.width, c.height);
                    if (pixels == null) continue;
                    bitmap = Bitmap.createBitmap(c.width, c.height, Bitmap.Config.ARGB_8888);
                    bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(pixels));
                    if (!c.underlines.isEmpty()) drawUnderlines(bitmap, lettersOf(p), c);
                }
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
            pageLetters.keySet().removeIf(p -> p < page - 2 || p > page + 3);
        }
        main.post(() -> { if (gen == generation) publish(); });
    }

    /**
     * A page that is only a picture (they get pages of their own, see the export CSS), drawn like
     * ReadEra does: fitted between the page margins and centred, upright in either direction.
     * Returns null for any other page.
     */
    private Bitmap drawPicturePage(int page, Config c) throws IOException {
        if (pictures.isEmpty()) return null;
        String xpath = pageXPath(page);
        if (!xpath.contains("/img")) return null;
        File file = pictures.get(ordinalOf(xpath));
        if (file == null || !file.isFile()) return null;
        int minMargin = Math.round(10 * c.density);
        int left = Math.max(minMargin, Math.round(c.width * c.horizontalPadding / 100f)) + c.insets.left;
        int right = Math.max(minMargin, Math.round(c.width * c.horizontalPadding / 100f)) + c.insets.right;
        int top = Math.max(minMargin, Math.round(c.height * c.verticalPadding / 100f)) + c.insets.top;
        int bottom = Math.max(minMargin, Math.round(c.height * c.verticalPadding / 100f)) + c.insets.bottom;
        int boxW = c.width - left - right, boxH = c.height - top - bottom;
        if (boxW <= 0 || boxH <= 0) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        float scale = Math.min(boxW / (float) bounds.outWidth, boxH / (float) bounds.outHeight);
        BitmapFactory.Options decode = new BitmapFactory.Options();
        decode.inSampleSize = 1;
        while (bounds.outWidth / (decode.inSampleSize * 2) >= bounds.outWidth * scale
            && bounds.outHeight / (decode.inSampleSize * 2) >= bounds.outHeight * scale) decode.inSampleSize *= 2;
        Bitmap image = BitmapFactory.decodeFile(file.getAbsolutePath(), decode);
        if (image == null) return null;
        int w = Math.round(bounds.outWidth * scale), h = Math.round(bounds.outHeight * scale);
        int x = left + (boxW - w) / 2, y = top + (boxH - h) / 2;
        Bitmap pageBitmap = Bitmap.createBitmap(c.width, c.height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(pageBitmap);
        canvas.drawColor(0xFF000000 | c.backgroundColor);
        canvas.drawBitmap(image, null, new Rect(x, y, x + w, y + h), new Paint(Paint.FILTER_BITMAP_FLAG));
        image.recycle();
        return pageBitmap;
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
            loadLetters(gen, page);
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
        view.setHighlight(new ArrayList<>(), 0);
        publish();
        final int gen = generation, page = current;
        engineHandler.post(() -> showPage(gen, page));
    }

    /** An underline of a word state, drawn here (see engineWordCss in nativeReaderWords.ts). */
    private static final class Underline {
        final int background;  // RGB of the words' background: how they are found in the page
        final int color;       // RGB
        final float thickness; // CSS px
        final String style;    // solid, dotted, dashed, wavy
        Underline(int background, int color, float thickness, String style) {
            this.background = background;
            this.color = color;
            this.thickness = thickness;
            this.style = style;
        }
    }

    /** Letters of each rendered page, for its underlines and the letter taps (engine thread). */
    private final Map<Integer, PageLetters> pageLetters = new HashMap<>();

    /** The page's letter boxes, asked once per page and kept with its bitmap. */
    private PageLetters lettersOf(int page) throws IOException {
        PageLetters known = pageLetters.get(page);
        if (known != null) return known;
        Config c = config;
        List<EraEngine.Item> req = new ArrayList<>();
        req.add(new EraEngine.Item(page));
        EraEngine.Response r = engine.request(EraEngine.CMD_REQ_PAGE_TEXT, req);
        int count = r.result == 0 ? r.items.size() / 5 : 0;
        float[] boxes = new float[count * 4];
        String[] texts = new String[count];
        for (int i = 0; i < count; i++) {
            int at = i * 5;
            float l = r.floatAt(at), t = r.floatAt(at + 1), rr = r.floatAt(at + 2), b = r.floatAt(at + 3);
            boxes[i * 4] = Math.min(l, rr) * c.width;
            boxes[i * 4 + 1] = Math.min(t, b) * c.height;
            boxes[i * 4 + 2] = Math.max(l, rr) * c.width;
            boxes[i * 4 + 3] = Math.max(t, b) * c.height;
            texts[i] = r.stringAt(at + 4);
        }
        PageLetters letters = new PageLetters(page, boxes, texts);
        pageLetters.put(page, letters);
        return letters;
    }

    /**
     * Underlines of the page's words, drawn on its bitmap. The engine only draws one-pixel
     * underlines in the text colour, through the furigana, so underlined states come with a
     * background one step off the page colour instead (invisible): a letter whose box shows that
     * colour belongs to that state, and consecutive letters of a state on one line get one line
     * with the state's colour, thickness and style — under the text in horizontal writing, on its
     * left in vertical writing (the furigana is on the right).
     */
    private void drawUnderlines(Bitmap bitmap, PageLetters letters, Config c) {
        if (c.underlines.isEmpty() || letters.texts.length == 0) return;
        Map<Integer, Underline> byBackground = new HashMap<>();
        for (Underline u : c.underlines) byBackground.put(u.background & 0xFFFFFF, u);
        // Ordinary letters are about the size of the median one; furigana is much smaller.
        List<Float> areas = new ArrayList<>();
        for (int i = 0; i < letters.texts.length; i++) {
            if (!letters.texts[i].trim().isEmpty()) areas.add(letterArea(letters, i));
        }
        if (areas.isEmpty()) return;
        java.util.Collections.sort(areas);
        float typical = areas.get(areas.size() / 2);

        // Resolve every real letter's state up front, then bridge a single letter that came back
        // null (antialiasing swallowed its background sample) when both its neighbours on the same
        // line already agree on one state: it is the same word, not a gap between two states.
        Underline[] states = new Underline[letters.texts.length];
        List<Integer> real = new ArrayList<>();
        for (int i = 0; i < letters.texts.length; i++) {
            if (letters.texts[i].trim().isEmpty() || isFurigana(letters, i, typical)) continue;
            states[i] = underlineAt(bitmap, rectOf(letters, i), byBackground);
            real.add(i);
        }
        for (int k = 1; k < real.size() - 1; k++) {
            int i = real.get(k);
            if (states[i] != null) continue;
            int prev = real.get(k - 1), next = real.get(k + 1);
            if (states[prev] != null && states[prev] == states[next]
                && onSameLine(rectOf(letters, prev), rectOf(letters, next), c.vertical)) {
                states[i] = states[prev];
            }
        }

        // Every run is placed before any line is drawn, so that finding a run's ink never mistakes
        // an already drawn line for text.
        List<RectF> runs = new ArrayList<>();
        List<Underline> runStates = new ArrayList<>();
        Underline current = null;
        RectF run = null;
        for (int i = 0; i < letters.texts.length; i++) {
            if (letters.texts[i].trim().isEmpty()) {
                addRun(runs, runStates, run, current);
                run = null;
                current = null;
                continue;
            }
            if (isFurigana(letters, i, typical)) continue;
            RectF box = rectOf(letters, i);
            Underline u = states[i];
            boolean sameLine = run != null && onSameLine(run, box, c.vertical);
            if (u != null && u == current && sameLine) {
                run.union(box);
                continue;
            }
            addRun(runs, runStates, run, current);
            current = u;
            run = u != null ? box : null;
        }
        addRun(runs, runStates, run, current);

        float[] inkLefts = new float[runs.size()];
        for (int k = 0; k < runs.size(); k++) {
            inkLefts[k] = c.vertical ? inkLeft(bitmap, runs.get(k), c) : Float.NaN;
        }
        Canvas canvas = new Canvas(bitmap);
        for (int k = 0; k < runs.size(); k++) {
            drawUnderline(canvas, runs.get(k), runStates.get(k), c, inkLefts[k]);
        }
    }

    private static void addRun(List<RectF> runs, List<Underline> runStates, RectF run, Underline u) {
        if (run == null || u == null) return;
        runs.add(run);
        runStates.add(u);
    }

    /**
     * Left edge of a vertical run's own text, or NaN. In vertical writing the engine's letter boxes
     * span about the whole step between columns, so their left edge lies far from the glyphs, on
     * the furigana of the column to the left. The text is the densest ink in the box: from there
     * the edge goes left until a clear gap, which leaves the neighbour's furigana out.
     */
    private static float inkLeft(Bitmap bitmap, RectF run, Config c) {
        int left = Math.max(0, (int) Math.floor(run.left));
        int right = Math.min(bitmap.getWidth(), (int) Math.ceil(run.right));
        int top = Math.max(0, (int) Math.floor(run.top));
        int bottom = Math.min(bitmap.getHeight(), (int) Math.ceil(run.bottom));
        int w = right - left, h = bottom - top;
        if (w <= 0 || h <= 0) return Float.NaN;
        int[] pixels = new int[w * h];
        bitmap.getPixels(pixels, 0, w, left, top, w, h);
        int bg = c.backgroundColor;
        int[] ink = new int[w];
        int densest = -1;
        for (int x = 0; x < w; x++) {
            for (int y = 0; y < h; y++) {
                int p = pixels[y * w + x];
                int d = Math.abs(((p >> 16) & 0xFF) - ((bg >> 16) & 0xFF))
                    + Math.abs(((p >> 8) & 0xFF) - ((bg >> 8) & 0xFF))
                    + Math.abs((p & 0xFF) - (bg & 0xFF));
                // State backgrounds are one step off the page colour: only real ink counts.
                if (d > 96) ink[x]++;
            }
            if (ink[x] > 0 && (densest < 0 || ink[x] > ink[densest])) densest = x;
        }
        if (densest < 0) return Float.NaN;
        int clear = Math.max(2, Math.round(c.fontSize * c.density * 0.25f));
        int edge = densest, blank = 0;
        for (int x = densest - 1; x >= 0 && blank < clear; x--) {
            if (ink[x] > 0) {
                edge = x;
                blank = 0;
            } else {
                blank++;
            }
        }
        return left + edge;
    }

    private static RectF rectOf(PageLetters letters, int i) {
        return new RectF(letters.boxes[i * 4], letters.boxes[i * 4 + 1], letters.boxes[i * 4 + 2], letters.boxes[i * 4 + 3]);
    }

    private static boolean onSameLine(RectF a, RectF b, boolean vertical) {
        return vertical
            ? Math.min(a.right, b.right) - Math.max(a.left, b.left) > b.width() / 2
            : Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > b.height() / 2;
    }

    /** The state whose background shows inside the letter box (sampled near its corners and centre), or null. */
    private static Underline underlineAt(Bitmap bitmap, RectF box, Map<Integer, Underline> byBackground) {
        int left = (int) Math.ceil(box.left) + 1, right = (int) Math.floor(box.right) - 2;
        int top = (int) Math.ceil(box.top) + 1, bottom = (int) Math.floor(box.bottom) - 2;
        int cx = (left + right) / 2, cy = (top + bottom) / 2;
        int[][] points = {
            { left, top }, { right, top }, { left, bottom }, { right, bottom },
            { cx, top }, { cx, bottom }, { left, cy }, { right, cy },
            // Interior samples away from the glyph's own antialiased edge.
            { cx, cy - 2 }, { cx, cy + 2 },
        };
        for (int[] point : points) {
            int x = Math.max(0, Math.min(bitmap.getWidth() - 1, point[0]));
            int y = Math.max(0, Math.min(bitmap.getHeight() - 1, point[1]));
            Underline u = byBackground.get(bitmap.getPixel(x, y) & 0xFFFFFF);
            if (u != null) return u;
        }
        return null;
    }

    private static void drawUnderline(Canvas canvas, RectF run, Underline u, Config c, float inkLeft) {
        if (run == null || u == null) return;
        float t = Math.max(1f, u.thickness * c.density);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(0xFF000000 | u.color);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(t);
        // The line runs along the text: horizontally under it, or vertically on its left. In
        // vertical writing it hugs the text's own ink (inkLeft) rather than the letter box, whose
        // left edge sits on the furigana of the neighbouring column.
        float x0, y0, x1, y1;
        if (c.vertical) {
            float gap = Math.max(1f, t * 0.6f);
            float edge = Float.isNaN(inkLeft) ? run.left : inkLeft;
            x0 = x1 = edge - gap - t / 2;
            y0 = run.top;
            y1 = run.bottom;
        } else {
            float gap = Math.max(1f, t * 0.6f);
            y0 = y1 = run.bottom + gap + t / 2;
            x0 = run.left;
            x1 = run.right;
        }
        android.graphics.Path path = new android.graphics.Path();
        if ("wavy".equals(u.style)) {
            float length = c.vertical ? y1 - y0 : x1 - x0;
            float wave = Math.max(4f, t * 3), amplitude = Math.max(1f, t);
            path.moveTo(x0, y0);
            for (float d = 0; d <= length; d += 1) {
                float off = (float) Math.sin(d / wave * Math.PI) * amplitude;
                if (c.vertical) path.lineTo(x0 + off, y0 + d);
                else path.lineTo(x0 + d, y0 + off);
            }
        } else {
            path.moveTo(x0, y0);
            path.lineTo(x1, y1);
            if ("dashed".equals(u.style)) {
                paint.setPathEffect(new android.graphics.DashPathEffect(new float[] { t * 3, t * 2 }, 0));
            } else if ("dotted".equals(u.style)) {
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setPathEffect(new android.graphics.DashPathEffect(new float[] { 0.1f, t * 2 }, 0));
            }
        }
        canvas.drawPath(path, paint);
    }

    /**
     * Letter boxes of a page (CMD_REQ_PAGE_TEXT: four floats in 0..1 screen coordinates, already
     * rotated in vertical mode, then the letter; "\n" marks a paragraph end).
     */
    private void loadLetters(int gen, int page) throws IOException {
        if (config == null) return;
        PageLetters pageLettersOf = lettersOf(page);
        if (gen != generation) return;
        letters = pageLettersOf;
    }

    /** Index of the letter under the point on the page on screen, or -1. */
    private int letterAt(float x, float y) {
        PageLetters page = letters;
        if (page == null || page.page != current) return -1;
        float slop = 4 * getContext().getResources().getDisplayMetrics().density;
        int best = -1;
        float bestArea = 0;
        for (int i = 0; i < page.texts.length; i++) {
            String text = page.texts[i];
            // trim() also skips the "\n" paragraph-end markers.
            if (text.trim().isEmpty()) continue;
            float l = page.boxes[i * 4] - slop, t = page.boxes[i * 4 + 1] - slop;
            float r = page.boxes[i * 4 + 2] + slop, b = page.boxes[i * 4 + 3] + slop;
            if (x < l || x > r || y < t || y > b) continue;
            // Furigana boxes overlap the base text: the larger letter wins.
            float area = (r - l) * (b - t);
            if (area > bestArea) {
                best = i;
                bestArea = area;
            }
        }
        return best;
    }

    @Override
    public void onTap(float x, float y, int edgeDirection) {
        float density = getContext().getResources().getDisplayMetrics().density;
        if (popupOpen) {
            JSObject event = new JSObject();
            event.put("x", x / density);
            event.put("y", y / density);
            event.put("closePopup", true);
            notifyListeners("tap", event);
            return;
        }
        int letter = letterAt(x, y);
        if (letter >= 0) {
            lookUpLetter(letter);
            return;
        }
        if (edgeDirection != 0) {
            view.turn(edgeDirection);
            return;
        }
        JSObject event = new JSObject();
        event.put("x", x / density);
        event.put("y", y / density);
        notifyListeners("tap", event);
    }

    /** Word tap: the xpath of the letter goes to the web UI, which finds the word and opens the dictionary. */
    private void lookUpLetter(int index) {
        PageLetters page = letters;
        float density = getContext().getResources().getDisplayMetrics().density;
        final int gen = generation;
        engineHandler.post(() -> {
            if (gen != generation) return;
            try {
                List<EraEngine.Item> req = new ArrayList<>();
                req.add(EraEngine.Item.str(page.page + ":" + index));
                EraEngine.Response r = engine.request(EraEngine.CMD_REQ_XPATH_BY_RECT_ID, req);
                String xpath = r.result == 0 ? r.stringAt(0) : "";
                if (xpath.isEmpty() || xpath.equals("-") || gen != generation) return;
                JSObject event = new JSObject();
                event.put("xpath", xpath);
                event.put("ordinal", ordinalOf(xpath));
                event.put("letter", page.texts[index]);
                event.put("index", index);
                event.put("page", page.page);
                event.put("left", page.boxes[index * 4] / density);
                event.put("top", page.boxes[index * 4 + 1] / density);
                event.put("right", page.boxes[index * 4 + 2] / density);
                event.put("bottom", page.boxes[index * 4 + 3] / density);
                notifyListeners("word", event);
            } catch (IOException e) {
                engineFailed(gen, e);
            }
        });
    }

    /** While the dictionary popup is open, a tap on the page closes it instead of acting. Closing it clears the highlight. */
    @PluginMethod
    public void setPopupOpen(PluginCall call) {
        boolean open = Boolean.TRUE.equals(call.getBoolean("open", false));
        main.post(() -> {
            popupOpen = open;
            if (!open && view != null) view.setHighlight(new ArrayList<>(), 0);
            call.resolve();
        });
    }

    /**
     * Highlights the looked-up word: the tapped letter (index from the "word" event) with
     * `before` letters before it and `after` after it, skipping furigana and paragraph ends.
     * color is ARGB.
     */
    @PluginMethod
    public void highlight(PluginCall call) {
        int page = call.getInt("page", -1);
        int index = call.getInt("index", -1);
        int before = Math.max(0, call.getInt("before", 0));
        int after = Math.max(0, call.getInt("after", 0));
        long color = call.getLong("color", 0x55FFE000L);
        main.post(() -> {
            PageLetters letters = this.letters;
            if (view == null || letters == null || letters.page != page || page != current || index < 0 || index >= letters.texts.length) {
                call.resolve();
                return;
            }
            float size = letterArea(letters, index);
            List<Integer> picked = new ArrayList<>();
            picked.add(index);
            for (int i = index - 1, n = 0; i >= 0 && n < before; i--) {
                if (isFurigana(letters, i, size)) continue;
                if (letters.texts[i].trim().isEmpty()) break;
                picked.add(0, i);
                n++;
            }
            for (int i = index + 1, n = 0; i < letters.texts.length && n < after; i++) {
                if (isFurigana(letters, i, size)) continue;
                if (letters.texts[i].trim().isEmpty()) break;
                picked.add(i);
                n++;
            }
            // One box per line: letters on the same line (column in vertical text) are merged.
            List<RectF> boxes = new ArrayList<>();
            float pad = 1.5f * getContext().getResources().getDisplayMetrics().density;
            RectF line = null;
            for (int i : picked) {
                RectF r = new RectF(letters.boxes[i * 4] - pad, letters.boxes[i * 4 + 1] - pad, letters.boxes[i * 4 + 2] + pad, letters.boxes[i * 4 + 3] + pad);
                boolean sameLine = line != null && (config != null && config.vertical
                    ? Math.min(line.right, r.right) - Math.max(line.left, r.left) > r.width() / 2
                    : Math.min(line.bottom, r.bottom) - Math.max(line.top, r.top) > r.height() / 2);
                if (sameLine) line.union(r);
                else {
                    line = r;
                    boxes.add(line);
                }
            }
            view.setHighlight(boxes, (int) color);
            call.resolve();
        });
    }

    private static float letterArea(PageLetters letters, int i) {
        return (letters.boxes[i * 4 + 2] - letters.boxes[i * 4]) * (letters.boxes[i * 4 + 3] - letters.boxes[i * 4 + 1]);
    }

    /** Furigana letters are much smaller than the text around them. */
    private static boolean isFurigana(PageLetters letters, int i, float textArea) {
        return letterArea(letters, i) < textArea * 0.45f;
    }

    /**
     * Highlights a sentence for read-aloud: relativeBlock is the block's index relative to the
     * first block on the current page (0 = first block visible), charOffset and charLength count
     * base-text characters (furigana excluded). color is ARGB.
     */
    @PluginMethod
    public void highlightRange(PluginCall call) {
        int relativeBlock = call.getInt("relativeBlock", -1);
        int charOffset = Math.max(0, call.getInt("charOffset", 0));
        int charLength = call.getInt("charLength", 0);
        long color = call.getLong("color", 0x40FFE000L);
        main.post(() -> {
            PageLetters letters = this.letters;
            if (view == null || letters == null || letters.page != current || relativeBlock < 0 || charLength <= 0) {
                call.resolve();
                return;
            }
            // Reference area for furigana detection: first non-empty letter.
            float refArea = 0;
            for (int i = 0; i < letters.texts.length; i++) {
                if (!letters.texts[i].trim().isEmpty()) { refArea = letterArea(letters, i); break; }
            }
            // Skip relativeBlock paragraph separators to reach the target block.
            int blockCount = 0;
            int i = 0;
            while (i < letters.texts.length && blockCount < relativeBlock) {
                if ("\n".equals(letters.texts[i])) blockCount++;
                i++;
            }
            if (blockCount < relativeBlock) { call.resolve(); return; }
            // Find the letter at charOffset (counting only base-text characters).
            int startIndex = -1, baseCount = 0;
            for (int j = i; j < letters.texts.length; j++) {
                if ("\n".equals(letters.texts[j])) break;
                if (isFurigana(letters, j, refArea)) continue;
                if (baseCount == charOffset) { startIndex = j; break; }
                baseCount++;
            }
            if (startIndex < 0) { call.resolve(); return; }
            // Collect charLength base-text characters (furigana included in the highlight).
            List<Integer> picked = new ArrayList<>();
            int remaining = charLength;
            for (int j = startIndex; j < letters.texts.length && remaining > 0; j++) {
                if ("\n".equals(letters.texts[j])) break;
                picked.add(j);
                if (!isFurigana(letters, j, refArea)) remaining--;
            }
            // Build highlight boxes (one per line, same as highlight()).
            List<RectF> boxes = new ArrayList<>();
            float pad = 1.5f * getContext().getResources().getDisplayMetrics().density;
            RectF line = null;
            for (int idx : picked) {
                RectF r = new RectF(letters.boxes[idx*4]-pad, letters.boxes[idx*4+1]-pad,
                                    letters.boxes[idx*4+2]+pad, letters.boxes[idx*4+3]+pad);
                boolean sameLine = line != null && (config != null && config.vertical
                    ? Math.min(line.right, r.right) - Math.max(line.left, r.left) > r.width() / 2
                    : Math.min(line.bottom, r.bottom) - Math.max(line.top, r.top) > r.height() / 2);
                if (sameLine) line.union(r);
                else { line = r; boxes.add(line); }
            }
            view.setHighlight(boxes, (int) color);
            call.resolve();
        });
    }

    /** Clears any word or sentence highlight on the page. */
    @PluginMethod
    public void clearHighlight(PluginCall call) {
        main.post(() -> {
            if (view != null) view.setHighlight(new ArrayList<>(), 0);
            call.resolve();
        });
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
        view.setLook(0xFF000000 | next.backgroundColor, next.vertical, next.invertTaps, next.kindleTaps, next.brightness);
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
                    pageLetters.clear();
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
            popupOpen = false;
            letters = null;
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
                    pageLetters.clear();
                }
            });
            call.resolve();
        });
    }
}
