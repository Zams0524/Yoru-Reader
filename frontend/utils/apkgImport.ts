// Reads an Anki .apkg (or .colpkg) file directly in the browser, without AnkiConnect: unzip with
// JSZip, open the embedded SQLite collection with sql.js, decompressing it with fzstd first when
// Anki wrote it in the newer zstd-compressed format. Handles the legacy schema (col.models /
// col.decks as JSON blobs) that every .apkg deck-share export uses regardless of the exporting
// Anki version, since that is what keeps a shared deck importable into any Anki install.
import JSZip from 'jszip';
// The inline build has its .wasm embedded as base64 right in the JS, so sql.js never needs to
// fetch() a separate asset at runtime - the plain 'sql.js' build does, and that fetch fails under
// Electron's file:// protocol ("both async and sync fetching of the wasm failed").
// @ts-ignore - no type declarations published for this specific build path.
import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import { decompress as zstdDecompress } from 'fzstd';
import type { AnkiReview } from './ankiCardImport';

export interface ApkgRawCard {
  /** Field name (from the note's model) -> field value. */
  fields: Record<string, string>;
  deckName: string;
  cardId: number;
  noteId: number;
  interval: number;
  reps: number;
  lapses: number;
  /** Anki's ease factor * 1000 (e.g. 2500 = 250%). */
  factor: number;
  /** Anki card type: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  type: number;
  /** Anki queue: -1 suspended, -2/-3 buried, 0 new, 1 learning, 2 review, 3 day-learning. */
  queue: number;
  /** New: queue position. Learning: next-review time, epoch seconds. Review/day-learning: days since the collection was created. */
  due: number;
  /** Last-modified time, epoch seconds. */
  mod: number;
  /** FSRS memory state Anki stored for the card (cards.data), when the deck uses FSRS. */
  memory: { stability: number; difficulty: number } | null;
  /** Last review time stored with that memory state, epoch seconds. */
  lastReviewSeconds?: number;
  /** The card's review history (revlog), oldest first. */
  reviews: AnkiReview[];
}

export interface ApkgCollection {
  cards: ApkgRawCard[];
  /** Collection creation time, epoch seconds: review due dates are day numbers counted from it. */
  crtSeconds: number | null;
}

let sqlPromise: Promise<any> | null = null;
function loadSql(): Promise<any> {
  if (!sqlPromise) sqlPromise = initSqlJs().catch((err: unknown) => { sqlPromise = null; throw err; });
  return sqlPromise;
}

async function extractCollectionBytes(zip: JSZip): Promise<Uint8Array> {
  const compressed = zip.file('collection.anki21b');
  if (compressed) {
    const bytes = await compressed.async('uint8array');
    return zstdDecompress(bytes);
  }
  const anki21 = zip.file('collection.anki21');
  if (anki21) return anki21.async('uint8array');
  const anki2 = zip.file('collection.anki2');
  if (anki2) return anki2.async('uint8array');
  throw new Error('No se encontró una base de datos de Anki reconocible dentro del archivo (collection.anki2/anki21/anki21b).');
}

const COLLECTION_NAMES = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

/** Which step of reading an .apkg is running, for the progress line and timeout errors. */
export type ApkgStep = 'reading' | 'decompressing' | 'opening' | 'cards' | 'history';

export class ApkgStepError extends Error {
  constructor(public step: ApkgStep, message: string) {
    super(message);
  }
}

/** Rejects when `promise` takes longer than `ms`, so a stuck read fails visibly instead of spinning forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, step: ApkgStep): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApkgStepError(step, `timeout:${step}`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Lets the WebView paint the progress line before the next synchronous step. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

/** Inflates a zip entry's raw bytes: stored as-is (method 0) or deflated (method 8). */
async function inflateEntry(method: number, raw: Uint8Array): Promise<Uint8Array | null> {
  if (method === 0) return raw;
  if (method !== 8 || typeof DecompressionStream === 'undefined') return null;
  const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads the collection database from the start of the file, entry by entry, and stops as soon
 * as it has it. Anki writes the collection first and the media after it, so a 300 MB deck only
 * needs its first few MB read, and nothing has to seek: Android hands the WebView picked files
 * through a content provider, where reading the end of a big file can fail or take very long.
 * Returns null when the zip doesn't record sizes in its local headers (then the central
 * directory is read instead).
 */
async function readCollectionFromStart(file: Blob): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (typeof file.stream !== 'function') return null;
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let buf = new Uint8Array(0);
  let done = false;
  // Makes sure at least `n` bytes are buffered; false at the end of the file.
  const ensure = async (n: number) => {
    while (buf.length + buffered < n && !done) {
      const next = await reader.read();
      if (next.done) { done = true; break; }
      chunks.push(next.value);
      buffered += next.value.length;
    }
    if (chunks.length) {
      const merged = new Uint8Array(buf.length + buffered);
      merged.set(buf, 0);
      let at = buf.length;
      for (const chunk of chunks) { merged.set(chunk, at); at += chunk.length; }
      buf = merged;
      chunks.length = 0;
      buffered = 0;
    }
    return buf.length >= n;
  };
  const found: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();
  try {
    for (;;) {
      if (!(await ensure(30))) break;
      const view = new DataView(buf.buffer, buf.byteOffset, buf.length);
      if (view.getUint32(0, true) !== 0x04034b50) break;
      const flags = view.getUint16(6, true);
      const method = view.getUint16(8, true);
      const compressedSize = view.getUint32(18, true);
      const nameLen = view.getUint16(26, true);
      const extraLen = view.getUint16(28, true);
      if (!(await ensure(30 + nameLen + extraLen))) break;
      const name = decoder.decode(buf.subarray(30, 30 + nameLen));
      // Media comes after the collection: nothing more to look for.
      if (/^\d+$/.test(name) || name === 'media') break;
      // Sizes only in a trailing data descriptor, or zip64: can't skip ahead without them.
      if (((flags & 0x08) && compressedSize === 0) || compressedSize === 0xffffffff) return null;
      const dataStart = 30 + nameLen + extraLen;
      if (!(await ensure(dataStart + compressedSize))) break;
      if (COLLECTION_NAMES.includes(name)) {
        const bytes = await inflateEntry(method, buf.slice(dataStart, dataStart + compressedSize));
        if (!bytes) return null;
        found[name] = bytes;
        if (name === COLLECTION_NAMES[0]) break;
      }
      let next = dataStart + compressedSize;
      if (flags & 0x08) {
        // Data descriptor after the data: 12 or 16 bytes (with its optional signature).
        if (!(await ensure(next + 4))) break;
        next += new DataView(buf.buffer, buf.byteOffset, buf.length).getUint32(next, true) === 0x08074b50 ? 16 : 12;
      }
      if (!(await ensure(next))) break;
      buf = buf.slice(next);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const name = COLLECTION_NAMES.find((n) => found[n]);
  return name ? { name, bytes: found[name] } : null;
}

/**
 * Reads just the collection database out of the .apkg zip, slicing the file instead of loading
 * it whole. A deck with audio and images (e.g. Core 2k/6k) can be hundreds of MB, which a phone's
 * WebView may not hold in memory at once; the collection itself is a few MB. Returns null when
 * the zip can't be read this way, so the caller falls back to JSZip.
 */
async function readCollectionFromBlob(file: Blob): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (typeof file.slice !== 'function') return null;
  const read = async (start: number, end: number) => new DataView(await file.slice(start, end).arrayBuffer());

  // End of central directory record: in the last 22 bytes + up to 64 KB of comment.
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await read(tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    // Zip64: the locator just before the EOCD points to the zip64 EOCD record.
    const locator = eocd - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== 0x07064b50) return null;
    const zip64Offset = Number(tail.getBigUint64(locator + 8, true));
    const zip64 = await read(zip64Offset, zip64Offset + 56);
    if (zip64.getUint32(0, true) !== 0x06064b50) return null;
    cdSize = Number(zip64.getBigUint64(40, true));
    cdOffset = Number(zip64.getBigUint64(48, true));
  }

  const cd = await read(cdOffset, cdOffset + cdSize);
  const entries: Record<string, { method: number; compressedSize: number; localOffset: number }> = {};
  const decoder = new TextDecoder();
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    const uncompressedSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    if (COLLECTION_NAMES.includes(name)) {
      // Zip64 extra field: 8-byte values for the 32-bit fields set to 0xFFFFFFFF, in this order.
      for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen;) {
        const id = cd.getUint16(x, true);
        const size = cd.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (uncompressedSize === 0xffffffff) q += 8;
          if (compressedSize === 0xffffffff) { compressedSize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) localOffset = Number(cd.getBigUint64(q, true));
        }
        x += 4 + size;
      }
      entries[name] = { method, compressedSize, localOffset };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  const name = COLLECTION_NAMES.find((n) => entries[n]);
  if (!name) return null;
  const entry = entries[name];
  const local = await read(entry.localOffset, entry.localOffset + 30);
  if (local.getUint32(0, true) !== 0x04034b50) return null;
  const dataStart = entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const raw = new Uint8Array(await file.slice(dataStart, dataStart + entry.compressedSize).arrayBuffer());
  const bytes = await inflateEntry(entry.method, raw);
  return bytes ? { name, bytes } : null;
}

/** The collection database from an .apkg/.colpkg file, zstd-decompressed when needed. */
/** Above this size the whole-file fallback (JSZip) is not tried: a phone can't hold it in memory. */
const WHOLE_FILE_LIMIT = 150 * 1024 * 1024;

async function readCollectionBytes(file: File, onStep: (step: ApkgStep) => void): Promise<Uint8Array> {
  let direct: { name: string; bytes: Uint8Array } | null = null;
  for (const [label, read] of [
    ['from the start', readCollectionFromStart],
    ['by the central directory', readCollectionFromBlob],
  ] as const) {
    try {
      direct = await withTimeout(read(file), 120000, 'reading');
    } catch (err) {
      console.warn(`Reading the Anki collection ${label} failed:`, err);
    }
    if (direct) break;
  }
  if (!direct && file.size > WHOLE_FILE_LIMIT) {
    throw new Error('apkg-unreadable');
  }
  if (direct) {
    if (direct.name !== 'collection.anki21b') return direct.bytes;
    onStep('decompressing');
    await nextFrame();
    return zstdDecompress(direct.bytes);
  }
  const zip = await withTimeout(file.arrayBuffer().then((buf) => JSZip.loadAsync(buf)), 180000, 'reading');
  onStep('decompressing');
  await nextFrame();
  return withTimeout(extractCollectionBytes(zip), 120000, 'decompressing');
}

/**
 * Field names per notetype ID, in field order. Anki moved this out of the col.models JSON blob
 * into its own relational "fields" table in schema v18 (Anki 2.1.28+); modern Anki leaves
 * col.models as an empty string, so that legacy path is tried first and this is the fallback.
 */
function fieldNamesByModelFromTable(db: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const fieldRows = db.exec('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord');
  if (!fieldRows.length) return out;
  for (const row of fieldRows[0].values) {
    const [ntid, , name] = row as [number, number, string];
    const key = String(ntid);
    if (!out[key]) out[key] = [];
    out[key].push(String(name));
  }
  return out;
}

/** Deck names by ID, from the same schema-v18 relational "decks" table as the fallback above. */
function deckNamesFromTable(db: any): Record<string, string> {
  const out: Record<string, string> = {};
  const deckRows = db.exec('SELECT id, name FROM decks');
  if (!deckRows.length) return out;
  for (const row of deckRows[0].values) {
    const [id, name] = row as [number, string];
    out[String(id)] = String(name);
  }
  return out;
}

/** Parses Anki's per-card `data` JSON for the FSRS memory state (s, d) and last review time (lrt). */
function parseCardData(raw: unknown): { memory: ApkgRawCard['memory']; lastReviewSeconds?: number } {
  if (!raw) return { memory: null };
  try {
    const data = JSON.parse(String(raw));
    const stability = Number(data?.s);
    const difficulty = Number(data?.d);
    const memory = stability > 0 && difficulty >= 1 ? { stability, difficulty } : null;
    const lastReviewSeconds = Number(data?.lrt) > 0 ? Number(data.lrt) : undefined;
    return { memory, lastReviewSeconds };
  } catch {
    return { memory: null };
  }
}

/** Every revlog entry, grouped by card id. */
function reviewsByCard(db: any): Map<number, AnkiReview[]> {
  const out = new Map<number, AnkiReview[]>();
  let rows: any[] = [];
  try {
    rows = db.exec('SELECT id, cid, ease, type, ivl FROM revlog ORDER BY id');
  } catch {
    return out;
  }
  if (!rows.length) return out;
  for (const row of rows[0].values) {
    const [id, cid, ease, type, ivl] = row as [number, number, number, number, number];
    const list = out.get(cid) || [];
    list.push({ at: Number(id), rating: Number(ease) || 0, type: Number(type) || 0, ivl: Number(ivl) || 0 });
    out.set(cid, list);
  }
  return out;
}

/** Reads every note+card pair from an Anki .apkg/.colpkg file, with each note's fields by name. */
export async function parseApkgFile(file: File): Promise<ApkgRawCard[]> {
  return (await parseApkgCollection(file)).cards;
}

/** Like parseApkgFile, plus each card's review history and the collection's creation time. */
export async function parseApkgCollection(file: File, onStep: (step: ApkgStep) => void = () => {}): Promise<ApkgCollection> {
  onStep('reading');
  await nextFrame();
  const bytes = await readCollectionBytes(file, onStep);
  onStep('opening');
  await nextFrame();
  const SQL = await withTimeout(loadSql(), 60000, 'opening');
  let db = new SQL.Database(bytes);
  try {
    // Modern Anki declares several columns (e.g. fields.name) with a custom "unicase" collation,
    // registered by Anki's own Rust backend but unknown to sql.js's plain SQLite build. Even a
    // plain SELECT against such a table then fails ("no query solution"), since the query planner
    // can't validate every index built on that table. Patch the schema text in sqlite_master to
    // drop the unregistered collation, then re-open from the patched bytes so SQLite reparses it -
    // a no-op when the file doesn't use it, since the REPLACE then matches nothing.
    db.run('PRAGMA writable_schema = ON');
    db.run("UPDATE sqlite_master SET sql = REPLACE(sql, ' COLLATE unicase', '') WHERE sql LIKE '%COLLATE unicase%'");
    db.run('PRAGMA writable_schema = RESET');
    const patched = db.export();
    db.close();
    db = new SQL.Database(patched);
    let modelsJson = '';
    let decksJson = '';
    let crtSeconds: number | null = null;
    try {
      const crtRows = db.exec('SELECT crt FROM col LIMIT 1');
      const crt = Number(crtRows[0]?.values?.[0]?.[0]);
      if (crt > 0) crtSeconds = crt;
    } catch {
      // No col.crt: review due dates fall back to last review + interval.
    }
    try {
      const colRows = db.exec('SELECT models, decks FROM col LIMIT 1');
      if (colRows.length && colRows[0].values.length) {
        [modelsJson, decksJson] = colRows[0].values[0] as [string, string];
      }
    } catch {
      // Schema without a models/decks column on "col" at all - fall through to the relational
      // schema below for both field and deck names.
    }

    let fieldNamesByModel: Record<string, string[]> = {};
    try {
      if (modelsJson) {
        const models = JSON.parse(String(modelsJson)) as Record<string, { flds?: { name: string; ord: number }[] }>;
        for (const [mid, model] of Object.entries(models)) {
          const sorted = [...(model.flds || [])].sort((a, b) => a.ord - b.ord);
          fieldNamesByModel[mid] = sorted.map((f) => f.name);
        }
      }
    } catch {
      // col.models wasn't valid JSON - fall through to the relational schema below.
    }
    if (Object.keys(fieldNamesByModel).length === 0) {
      fieldNamesByModel = fieldNamesByModelFromTable(db);
    }

    let decks: Record<string, { name?: string }> = {};
    try {
      if (decksJson) decks = JSON.parse(String(decksJson)) as Record<string, { name?: string }>;
    } catch {
      // col.decks wasn't valid JSON - fall through to the relational schema below.
    }
    let deckNames = Object.fromEntries(Object.entries(decks).map(([id, d]) => [id, d.name || '']));
    if (Object.values(deckNames).every((name) => !name)) {
      deckNames = deckNamesFromTable(db);
    }

    onStep('cards');
    await nextFrame();
    // cards.data (FSRS memory state) only exists in newer collections.
    let rows: any[];
    try {
      rows = db.exec(`
        SELECT n.mid, n.flds, c.did, c.ivl, c.reps, c.lapses, c.factor, c.type, c.due, c.mod, c.id, c.nid, c.queue, c.data
        FROM cards c JOIN notes n ON n.id = c.nid
      `);
    } catch {
      rows = db.exec(`
        SELECT n.mid, n.flds, c.did, c.ivl, c.reps, c.lapses, c.factor, c.type, c.due, c.mod, c.id, c.nid, c.queue, NULL
        FROM cards c JOIN notes n ON n.id = c.nid
      `);
    }
    if (!rows.length) return { cards: [], crtSeconds };
    onStep('history');
    await nextFrame();
    const reviews = reviewsByCard(db);

    const out: ApkgRawCard[] = [];
    for (const row of rows[0].values) {
      const [mid, flds, did, ivl, reps, lapses, factor, type, due, mod, id, nid, queue, data] = row as [
        number, string, number, number, number, number, number, number, number, number, number, number, number, string | null
      ];
      const names = fieldNamesByModel[String(mid)] || [];
      const values = String(flds).split('\x1f');
      const fields: Record<string, string> = {};
      names.forEach((name, i) => { fields[name] = values[i] || ''; });
      const { memory, lastReviewSeconds } = parseCardData(data);
      out.push({
        fields,
        deckName: deckNames[String(did)] || 'Imported',
        cardId: Number(id),
        noteId: Number(nid),
        interval: ivl || 0,
        reps: reps || 0,
        lapses: lapses || 0,
        factor: factor || 2500,
        type: typeof type === 'number' ? type : 0,
        queue: typeof queue === 'number' ? queue : 0,
        due: due || 0,
        mod: mod || 0,
        memory,
        lastReviewSeconds,
        reviews: reviews.get(Number(id)) || [],
      });
    }
    return { cards: out, crtSeconds };
  } finally {
    db.close();
  }
}
