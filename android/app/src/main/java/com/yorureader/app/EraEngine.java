package com.yorureader.app;

import android.system.Os;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Client for the OpenReadEra EraEPUB engine (GPL-2.0, a CoolReader/crengine fork), which runs as
 * its own process (liberaepub.so, an executable shipped in jniLibs) and talks over two FIFOs
 * (orebridge/StProtocol): request = cmd byte (|0x80 when data follows), then items of
 * [type byte (|0x80 when another follows), uint32 LE value, payload when type is an array].
 * Response = cmd byte, result byte, then items in the same format. Not thread-safe: use it from
 * one thread.
 */
final class EraEngine {
    private static final String TAG = "YoruEraEngine";

    // orebridge/include/StProtocol.h
    static final int CMD_NOTIF_READY = 1;
    static final int CMD_REQ_OPEN = 2;
    static final int CMD_REQ_QUIT = 4;
    static final int CMD_REQ_PAGE_RENDER = 10;
    static final int CMD_REQ_PAGE_TEXT = 14;
    static final int CMD_REQ_SET_FONT_CONFIG = 18;
    static final int CMD_REQ_SET_CONFIG = 20;
    static final int CMD_REQ_CRE_PAGE_BY_XPATH = 24;
    static final int CMD_REQ_CRE_PAGE_XPATH = 26;
    static final int CMD_REQ_XPATH_BY_RECT_ID = 46;
    static final int CMD_REQ_FONT_NAMES = 70;
    static final int TYPE_FIX_INT = 3;
    static final int TYPE_FIX_FLOAT = 4;
    static final int TYPE_ARRAY = 5;
    // orebridge/include/openreadera.h
    static final int DOC_FORMAT_HTML = 13;
    static final int CONFIG_EMBEDDED_STYLES = 101;
    static final int CONFIG_FONT_FACE_MAIN = 103;
    static final int CONFIG_FONT_COLOR = 105;
    static final int CONFIG_FONT_SIZE = 106;
    static final int CONFIG_INTERLINE = 110;
    static final int CONFIG_BACKGROUND_COLOR = 111;
    static final int CONFIG_MARGIN_TOP = 113;
    static final int CONFIG_MARGIN_BOTTOM = 114;
    static final int CONFIG_MARGIN_LEFT = 115;
    static final int CONFIG_MARGIN_RIGHT = 116;
    static final int CONFIG_PAGE_WIDTH = 117;
    static final int CONFIG_PAGE_HEIGHT = 118;
    static final int CONFIG_TEXT_ALIGN = 119;
    static final int CONFIG_HYPHENATION = 120;
    static final int CONFIG_VERTICAL_MODE = 203;
    static final int CONFIG_TEXT_INDENT = 204;
    static final int CONFIG_PARAGRAPH_MARGIN = 205;

    /** One request or response item: an int, or a byte array (strings are null-terminated). */
    static final class Item {
        final int type;
        final int value;
        final byte[] array;
        Item(int value) { this.type = TYPE_FIX_INT; this.value = value; this.array = null; }
        Item(int type, int value, byte[] array) { this.type = type; this.value = value; this.array = array; }
        static Item str(String s) {
            byte[] utf8 = s.getBytes(StandardCharsets.UTF_8);
            byte[] withNul = new byte[utf8.length + 1];
            System.arraycopy(utf8, 0, withNul, 0, utf8.length);
            return new Item(TYPE_ARRAY, withNul.length, withNul);
        }
        String asString() {
            if (array == null) return "";
            int end = 0;
            while (end < array.length && array[end] != 0) end++;
            return new String(array, 0, end, StandardCharsets.UTF_8);
        }
    }

    static final class Response {
        int cmd;
        int result;
        final List<Item> items = new ArrayList<>();
        int intAt(int index, int fallback) {
            return index < items.size() && items.get(index).type == TYPE_FIX_INT ? items.get(index).value : fallback;
        }
        float floatAt(int index) {
            return index < items.size() ? Float.intBitsToFloat(items.get(index).value) : 0f;
        }
        String stringAt(int index) {
            return index < items.size() ? items.get(index).asString() : "";
        }
    }

    private Process process;
    private DataInputStream in;
    private BufferedOutputStream out;
    private final ArrayDeque<String> logTail = new ArrayDeque<>();
    /** Page pixels are width*height*4 bytes per render: reuse the buffer instead of allocating it each time. */
    private byte[] pixelBuffer;

    void start(File engineBinary, File workDir) throws IOException {
        File toEngine = new File(workDir, "ore-in");
        File fromEngine = new File(workDir, "ore-out");
        toEngine.delete();
        fromEngine.delete();
        try {
            Os.mkfifo(toEngine.getAbsolutePath(), 0600);
            Os.mkfifo(fromEngine.getAbsolutePath(), 0600);
        } catch (Exception e) {
            throw new IOException("mkfifo: " + e.getMessage(), e);
        }
        process = new ProcessBuilder(engineBinary.getAbsolutePath(), toEngine.getAbsolutePath(), fromEngine.getAbsolutePath())
            .redirectErrorStream(true)
            .start();
        drainOutput(process);
        // The engine opens its output first and sends READY, then opens its input. Opening a FIFO
        // blocks until the other side opens it, so a crashed engine would hang here forever.
        ExecutorService opener = Executors.newSingleThreadExecutor();
        try {
            Future<DataInputStream> opening = opener.submit(() ->
                new DataInputStream(new BufferedInputStream(new FileInputStream(fromEngine), 1 << 16)));
            try {
                in = opening.get(8, TimeUnit.SECONDS);
            } catch (Exception e) {
                process.destroy();
                // Unblock the pending open, then give up.
                try (FileOutputStream unblock = new FileOutputStream(fromEngine)) { unblock.write(0); } catch (IOException ignored) { }
                throw new IOException("Engine did not start: " + logTail(), e);
            }
        } finally {
            opener.shutdownNow();
        }
        Response ready = readResponse();
        if (ready.cmd != CMD_NOTIF_READY) throw new IOException("Engine did not report ready: " + ready.cmd);
        out = new BufferedOutputStream(new FileOutputStream(toEngine), 1 << 16);
    }

    Response request(int cmd, List<Item> items) throws IOException {
        if (out == null) throw new IOException("Engine not running");
        out.write(cmd | (items.isEmpty() ? 0 : 0x80));
        for (int i = 0; i < items.size(); i++) {
            Item item = items.get(i);
            out.write(item.type | (i < items.size() - 1 ? 0x80 : 0));
            writeIntLE(item.value);
            if (item.type == TYPE_ARRAY && item.array != null) out.write(item.array);
        }
        out.flush();
        Response response = readResponse();
        if (response.cmd != cmd + 1) throw new IOException("Unexpected response " + response.cmd + " to " + cmd);
        return response;
    }

    /** Renders a page and returns its RGBA pixels (a reused buffer, valid until the next call), or null. */
    byte[] renderPage(int page, int width, int height) throws IOException {
        List<Item> req = new ArrayList<>();
        req.add(new Item(page));
        req.add(new Item(width));
        req.add(new Item(height));
        Response r = request(CMD_REQ_PAGE_RENDER, req);
        if (r.result != 0 || r.items.isEmpty() || r.items.get(0).array == null) return null;
        byte[] pixels = r.items.get(0).array;
        return pixels.length == width * height * 4 ? pixels : null;
    }

    private Response readResponse() throws IOException {
        Response response = new Response();
        int cmd = in.readUnsignedByte();
        response.cmd = cmd & 0x7F;
        response.result = in.readUnsignedByte();
        boolean more = (cmd & 0x80) != 0;
        while (more) {
            int type = in.readUnsignedByte();
            more = (type & 0x80) != 0;
            type &= 0x7F;
            int value = readIntLE();
            byte[] array = null;
            if (type == TYPE_ARRAY && value > 0) {
                if (response.cmd == CMD_REQ_PAGE_RENDER + 1) {
                    if (pixelBuffer == null || pixelBuffer.length != value) pixelBuffer = new byte[value];
                    array = pixelBuffer;
                } else {
                    array = new byte[value];
                }
                in.readFully(array);
            }
            response.items.add(new Item(type, value, array));
        }
        return response;
    }

    private void writeIntLE(int v) throws IOException {
        out.write(v & 0xFF);
        out.write((v >>> 8) & 0xFF);
        out.write((v >>> 16) & 0xFF);
        out.write((v >>> 24) & 0xFF);
    }

    private int readIntLE() throws IOException {
        int b0 = in.readUnsignedByte(), b1 = in.readUnsignedByte(), b2 = in.readUnsignedByte(), b3 = in.readUnsignedByte();
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    /** Reads what the engine prints (it must never fill the pipe and block) and keeps the last lines. */
    private void drainOutput(Process engineProcess) {
        Thread reader = new Thread(() -> {
            try (BufferedReader lines = new BufferedReader(new InputStreamReader(engineProcess.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = lines.readLine()) != null) {
                    Log.d(TAG, line);
                    synchronized (logTail) {
                        logTail.addLast(line);
                        while (logTail.size() > 30) logTail.removeFirst();
                    }
                }
            } catch (IOException ignored) {
            }
        }, "era-engine-log");
        reader.setDaemon(true);
        reader.start();
    }

    String logTail() {
        synchronized (logTail) {
            return String.join("\n", logTail);
        }
    }

    boolean isRunning() {
        return out != null && process != null && process.isAlive();
    }

    void stop() {
        try {
            if (out != null) {
                out.write(CMD_REQ_QUIT);
                out.flush();
            }
        } catch (IOException ignored) {
        }
        if (process != null) process.destroy();
        try { if (in != null) in.close(); } catch (IOException ignored) { }
        try { if (out != null) out.close(); } catch (IOException ignored) { }
        in = null;
        out = null;
        process = null;
        pixelBuffer = null;
    }
}
